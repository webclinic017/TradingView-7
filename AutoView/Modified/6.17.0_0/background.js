"use strict"
console.log("Initialized")

// Globals
window.ACCESS = {
	origins: [],
	permissions: [],
}
window.STORAGE = {
	local: {},
	sync: {},
}
window.TRADINGVIEW = TradingView()

chrome.runtime.onInstalled.addListener(run.bind(window, chrome_runtime_onInstall))
chrome.runtime.onMessage.addListener(run.bind(window, executeMessage))

chrome.tabs.onCreated.addListener(run.bind(window.TRADINGVIEW, window.TRADINGVIEW.toggleTradingViewListener))
chrome.tabs.onUpdated.addListener(run.bind(window.TRADINGVIEW, window.TRADINGVIEW.toggleTradingViewListener))
chrome.tabs.onRemoved.addListener(run.bind(window.TRADINGVIEW, window.TRADINGVIEW.toggleTradingViewListener))

run(init)


function* chrome_runtime_onInstall(details) {
	const manifest = chrome.runtime.getManifest()

	console.info("Event:", details.reason)

	switch (details.reason) {
		case "shared_module_update":
		break

		case "install":
			gaEvent("Autoview", "install", manifest.version)

			yield* window.TRADINGVIEW.reloadTradingViewTabs()
			break

		case "chrome_update":
		case "update":
			gaEvent("Autoview", "update", manifest.version)

			yield* window.TRADINGVIEW.reloadTradingViewTabs()
	}
}

/**
 *
 * @param message
 * @param sender
 * @param sendResponse
 */
function* executeMessage(message, sender, sendResponse) {
	if (sender && sender.hasOwnProperty("tab") && sender.tab.index < 0) {
		return null // Ignore pre-render tabs
	}

	if (chrome.runtime.lastError) {
		throw new Error(chrome.runtime.lastError)
	}

	if (!message || !message.method) {
		return null // Unknown message provided
	}

	const methods = {
		// TradingView
		"content.connect": function* (msg) {},
		"content.disconnect": function* (msg) {},
		"create_alert": function* (msg) {
			msg.request.id = msg.response.p.id
			msg.response.p = msg.request

			yield* methods["event"](msg)
		},
		"event": function* (msg) {
			const alert = Alert(msg.response.p)
			const lastEventId = yield* window.TRADINGVIEW.getTradingViewAttribute("EVENT_ID")

			if (alert.eid > lastEventId) {
				yield* window.TRADINGVIEW.setTradingViewAttribute("EVENT_ID", alert.eid)

				for (let i = 0; i < alert.commands.length; i++) {
					const command = alert.commands[i]
					const isDelay = command.hasOwnProperty("delay")
					const isCommand = !isDelay || command.hasOwnProperty("c") || command.hasOwnProperty("b")

					try {
						// Delay
						if (isDelay) {
							const delay = Number(command.delay.resolve(0))
							yield sleep.bind(this, delay)
						}

						// Exchange
						if (isCommand) {
							let exchange = Broker().getExchange(command.e, command.s)
							if (exchange) {
								gaEvent(exchange.getExchangeName(), "command", command.s)

								yield* exchange.executeCommand(command)
							}
						}
					} catch (ex) {
						console.warn("Command #", i, ex, alert, command)
						// TODO Provide additional information for debugging
						ga("send", "exception", {
							"exDescription": ex.message,
							"exFatal": false,
						})
					}
				}
			}
		},
		// Ping
		"ping": function* (msg) {},
		// Storage
		"storage.clear": function* (msg) {
			const namespace = msg.namespace
			const result = yield* StorageInternal(namespace).clearStorage()

			sendResponse(result)
		},
		"storage.get": function* (msg) {
			const keys = msg.keys
			const namespace = msg.namespace
			const value = yield* StorageInternal(namespace).getStorageValue(keys)

			sendResponse(value)
		},
		"storage.set": function* (msg) {
			const keysEndWithValue = msg.value
			const namespace = msg.namespace
			const value = yield* StorageInternal(namespace).setStorageValue(keysEndWithValue)

			sendResponse(value)
		},
		// TradingView
		"tradingview.set": function* (msg) {
			const value = msg.value.pop()
			const key = msg.value.pop()
			const result = yield* window.TRADINGVIEW.setTradingViewAttribute(key, value)

			sendResponse(result)
		},
	}

	if (methods.hasOwnProperty(message.method)) {
		yield* methods[message.method](message)
	}
}

function* init() {
	// Save and sync internal cache
	setInterval(run.bind(this, storage_save.bind(this)), 15000) // 15 seconds
	// Load permissions, subscriptions
	setInterval(run.bind(this, refresh_account.bind(this)), 300000) // 5 minutes

	yield* load_storage()
	yield* refresh_account()
	yield* window.TRADINGVIEW.toggleTradingViewListener()
	yield* window.TRADINGVIEW.reloadTradingViewTabs()

	const binancePermission = yield* Binance().exchangeHasPermission()
	if (binancePermission) {
		yield* Binance().exchangeTime()
	}

	const gdaxPermission = yield* GDAX().exchangeHasPermission()
	if (gdaxPermission) {
		yield* GDAX().exchangeTime()
	}
}

function* load_access() {
	const access = yield permissions_all.bind(this)

	return access
}

function* load_account() {
	let permissions = Permissions().validateState()
	let purchases = []
	try {
		const google_payments = (yield* StorageInternal("sync").getStorageValue("permissions", "google_payments")) || false
		if (google_payments) {
			// Retrieve active subscriptions
			const cws_purchases = yield* inapp().getPurchases()
			purchases = [].concat(purchases, cws_purchases)

			yield* PWP().checkPurchases(purchases)
		}
	} catch (ex) {
		// TODO console.warn("Google", ex.message)
	}

	try {
		// Retrieve active subscriptions
		const pwp_purchases = yield* PWP().getExchangeSubscriptions()
		purchases = [].concat(purchases, pwp_purchases)
	} catch (ex) {
		// TODO console.warn("Pay with Pink", ex.message)
	}

	// Uniquely include newly obtained permissions
	for (let i = 0; i < purchases.length; i++) {
		const purchase = purchases[i]
		const permission = purchase.sku

		if (purchase.state === "ACTIVE") {
			permissions.permissions.push(permission)
		}
	}

	return permissions
}

function* load_storage() {
	const namespace = "sync"
	let storage = (yield* Storage(namespace).getStorageValue()) || {}

	// Storage is kept internally to avoid hitting chrome.storage rate limits (refer to storage_save())
	window.STORAGE[namespace] = storage

	if (!storage.hasOwnProperty("exchanges")) {
		storage.exchanges = {}
	}
	if (!storage.hasOwnProperty("permissions")) {
		storage.permissions = {
			google_payments: false,
		}
	}

	for (let key in storage) {
		if (storage.hasOwnProperty(key)) {
			const alias = key.toUpperCase()
			let value = storage[key]

			// Original model (< 1.0.0)
			if (Broker().isExchangeAlias(alias)) {
				value.private = value.private || ""
				value.public = value.public || ""

				// Convert to new model
				storage.exchanges[alias] = {
					"*": value
				}

				// Unset original model
				delete storage[key]
			}
			// Account access
			else if (key === "exchanges") {
				// Skip; Credentials are loaded upon request via Exchange()
			}
			// TradingView
			else if (key === "event_id" || key === "private_channel") {
				yield* window.TRADINGVIEW.setTradingViewAttribute(key, value)
				// Unset original model
				delete storage[key]
			}
		}
	}

	console.log("Storage loaded.")
}

function* refresh_account() {
	const access = yield* load_access()
	const account = yield* load_account()
	if (Permissions(access).getLength() && Permissions(account).getLength()) {
		window.ACCESS = {}
		Permissions(window.ACCESS).grant(access)
		Permissions(window.ACCESS).grant(account)
	}
}

function* storage_save() {
	const namespace = "sync"
	const storage = yield* StorageInternal(namespace).getStorageValue()

	const json = JSON.stringify(storage)
	const hash = md5(json)
	const name = "storage_" + namespace + "_hash"

	// Save any changes when they occurred
	if (!window.hasOwnProperty(name) || window[name] !== hash) {
		window[name] = hash

		yield* Storage(namespace).clearStorage()
		yield* Storage(namespace).setStorageValue(storage)
	}
}
