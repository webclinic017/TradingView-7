"use strict"

window.GEMINI_SANDBOX_NONCE = 0
window.GEMINI_SANDBOX_NONCE_OFFSET = 0

/**
 *
 * @returns {*}
 * @constructor
 */
function GeminiSandbox() {
	let state = {
		aliases: [
			"GEMINISANDBOX",
			"GEMINI-SANDBOX"
		],
		endpoint: "https://api.sandbox.gemini.com",
		fee: 0.01, // 1.00%
		fields: {
			public: {
				label: "API key",
				message: ""
			},
			private: {
				label: "API secret",
				message: ""
			},
		},
		name: "Gemini Sandbox (beta)",
		patterns: [],
		permissions: {
			origins: [
				"https://*.gemini.com/*"
			],
			permissions: [
			]
		},
		subscriptions: {
			active: [
			],
			inactive: [
			],
		},
		version: "v1",
		website: "https://exchange.sandbox.gemini.com"
	}

	function* account() {
		let balances = {}
		const response = yield* post.call(this, "/balances")
		response.forEach((balance) => {
			if (balance.type === "exchange") {
				balances[balance.currency] = {
					available: Number(balance.available),
					balance: Number(balance.amount)
				}
			}
		})
		return balances
	}

	function* ordersCancel(order) {
		if (typeof order !== "object") {
			throw new TypeError("Invalid order provided: " + typeof order)
		}

		let params = {}
		params.order_id = order.order_id

		return yield* post.call(this, "/order/cancel", params)
	}

	function* ordersCancelAll(Command) {
		const pair = symbolPair(Command.s)
		let orders = yield* ordersOpen.call(this, pair.symbol)

		orders = orders.filter((order) => {
			if (pair.symbol !== order.symbol.toUpperCase()) {
				return false // Symbol mismatch
			}
			if (Command.b && ((Command.isBid && order.side !== "buy") || (Command.isAsk && order.side !== "sell"))) {
				return false // buy, sell
			}
			if (Command.fp && Command.fp.compare(order.price)) {
				return false // Price mismatch
			}

			return true
		})

		// Limit the number of cancelled orders by the requested "Cancel Maximum"
		const end = Command.cm.reference(orders.length).resolve(0)
		if (Command.cm.getMax() < orders.length) {
			switch (Command.cmo) {
				case "newest":
					sortByIndex(orders, "timestamp", true)
					break
				case "oldest":
					sortByIndex(orders, "timestamp")
					break
				case "lowest":
					sortByIndex(orders, "price")
					break
				case "highest":
					sortByIndex(orders, "price", true)
					break
				case "smallest":
					sortByIndex(orders, "remaining_amount")
					break
				case "biggest":
					sortByIndex(orders, "remaining_amount", true)
					break
				case "random":
					shuffle(orders)
			}
			orders = orders.slice(0, end)
		}

		for (let i = 0; i < orders.length; i++) {
			const order = orders[i]
			if (Command.d) {
				console.info(this.getExchangeName(), "Order", order.remaining_amount, "@", order.price, "would be cancelled")
			} else {
				yield* ordersCancel.call(this, order)
			}
		}
	}

	function* ordersOpen(symbol) {
		return yield* post.call(this, "/orders")
	}

	function* positionsCloseAll(Command) {
		throw new ReferenceError(this.getExchangeName() + " does not support Margin trading.")
	}

	function* get(resource, query) {
		resource = state.endpoint + "/" + state.version + "/" + resource.replace(/^\/+/, "")

		return yield* this.getRequest(resource, query, null, "json")
	}

	function* getNonce() {
		let nonce = Math.round(Date.now() / 1000) * 1000 // second precision

		if (window.GEMINI_SANDBOX_NONCE != nonce) {
			window.GEMINI_SANDBOX_NONCE_OFFSET = -1
		}

		window.GEMINI_SANDBOX_NONCE = nonce
		window.GEMINI_SANDBOX_NONCE_OFFSET++

		nonce += window.GEMINI_SANDBOX_NONCE_OFFSET

		return nonce
	}

	function* post(resource, parameters) {
		const nonce = yield* getNonce()

		// Version (e.g. /v1/) is included in signature
		resource = "/" + state.version + "/" + resource.replace(/^\/+/, "")

		parameters = parameters || {}
		parameters.request = resource
		parameters.nonce = nonce

		const credentials = yield* this.getExchangeCredentials("private")
		const data = JSON.stringify(parameters)
		const payload = window.btoa(data) // base64
		const signature = () => {
			let sha = new jsSHA("SHA-384", "TEXT")
			sha.setHMACKey(credentials.private, "TEXT")
			sha.update(payload)
			return sha.getHMAC("HEX")
		}

		let headers = {}
		headers["Cache-Control"] = "no-cache"
		//headers["Content-Length"] = "0"
		headers["Content-Type"] = "text/plain"
		headers["X-GEMINI-APIKEY"] = credentials.public
		headers["X-GEMINI-PAYLOAD"] = payload
		headers["X-GEMINI-SIGNATURE"] = signature()

		resource = state.endpoint + resource

		try {
			const response = yield* this.postRequest(resource, data, headers, "json")

			return response
		} catch (ex) {
			if (ex.hasOwnProperty("error")) {
				throw new Error(ex.error)
			}
			if (ex.hasOwnProperty("message")) {
				throw new Error(ex.message)
			}
			throw new Error("An unknown error has occurred.")
		}
	}

	function* symbolInfo(symbol) {
		const resource = chrome.runtime.getURL("/cache/gemini/market_data.json")
		const response = yield* this.getRequest(resource, null, null, "json")

		if (response.hasOwnProperty(symbol)) {
			return response[symbol]
		}

		throw new Error("Market Symbol not found: " + symbol)
	}

	function symbolPair(symbol) {
		symbol = symbol.toUpperCase()
		const reg = /^(.+)(BTC|ETH|USD)$/i
		const result = reg.exec(symbol)
		let so = {}

		if (!result) {
			throw new Error("Unknown market symbol: " + symbol)
		}

		so.main = result ? result[2] : ""
		so.pair = result ? result[1] : ""
		so.precision = 10
		so.symbol = so.pair + so.main

		return so
	}

	function* symbolTicker(symbol) {
		const resource = "/pubticker/" + symbol.toLowerCase()
		const ticker = yield* get.call(this, resource, null, null, "json")

		return ticker
	}

	function testCommand() {
		const alert = Alert({
			desc: "d=1 b=buy q=1%",
			sym: this.getExchangeAlias() + ":BTCUSD"
		})
		const commands = alert.commands
		const command = commands.shift()

		return command
	}

	function* trade(Command) {
		if (!Command.b) {
			throw new SyntaxError("Command [b]ook parameter is invalid.")
		}
		if (Command.isMarginTrading) {
			throw new Error(this.getExchangeName() + " does not support Margin trading.")
		}

		const pair = symbolPair(Command.s)
		const market = symbolInfo(Command.s)
		const balances = yield* account.call(this)
		const currency = Command.isBid ? pair.main : pair.pair

		if (!balances.hasOwnProperty(currency)) {
			throw new ReferenceError("Account Balance (" + currency + ") not available.")
		}

		const ticker = yield* symbolTicker.call(this, pair.symbol)
		if (!ticker) {
			throw new ReferenceError("Ticker (" + pair.symbol + ") is not available.")
		}

		const overview = balances[currency]
		const balance = Command.y === "equity" ? overview.balance : overview.available
		const first = ((Command.isBid && Command.t !== "market") || (Command.isAsk && Command.t === "market")) ? ticker.bid : ticker.ask
		let price = Command.p.relative(first).resolve(market.market_precision)
		if (Command.fp) {
			price = Command.fp.resolve(market.market_precision)
		}
		let available = (1 - state.fee) * balance

		if (Command.isBid && Command.u !== "currency") {
			available = balance / price
			Command.q.reference(available)
		} else if (Command.u === "currency") {
			if (Command.isAsk) {
				available = balance * price
			}
			Command.q.reference(available)
			Command.q.div(price)
		} else {
			Command.q.reference(available)
		}
		
		let order = {}
		order.symbol = pair.symbol
		order.amount = Command.q.resolve(market.order_precision)
		order.price = price
		order.side = Command.isBid ? "buy" : "sell"
		
		switch (Command.t) {
			case "fok":
				order.options = ["immediate-or-cancel"]
				break
			case "post":
				order.options = ["maker-or-cancel"]
				break
			case "market":
			case "limit":
			default:
				order.options = []
		}
		order.type = "exchange limit" //only "exchange limit" supported

		if (Command.d) {
			console.log(this.getExchangeName(), order)
			return false // Disabled
		}

		return yield* post.call(this, "/order/new", order)
	}


	return Object.assign(
		{},
		Exchange(state),
		{
			exchangeOrdersCancelAll: ordersCancelAll,
			exchangePositionsCloseAll: positionsCloseAll,
			exchangeTrade: trade,
			getExchangeTestCommand: testCommand,
		}
	)
}
