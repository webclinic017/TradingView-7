"use strict"
window.BITMEX_LEVERAGE = null

/**
 *
 * @returns {*}
 * @constructor
 */
function BitMEX() {
	let state = {
		addRequestListener: true,
		aliases: [
			"BITMEX",
		],
		endpoint: "https://www.bitmex.com",
		fields: {
			public: {
				label: "ID",
				message: "",
			},
			private: {
				label: "Secret",
				message: "",
			}
		},
		name: "BitMEX",
		patterns: [

		],
		permissions: {
			origins: [
				"https://*.bitmex.com/*"
			],
			permissions: [
				"webRequest",
				"webRequestBlocking",
			],
		},
		subscriptions: {
			active: [
				"brnzhjdgkscloyiwtfupevmxaq", // Autoview Bronze
				"brnzvpskjlyxdewhoaguftcqmi", // Autoview Bronze - Yearly
			],
			inactive: [
				"dnsfjeqaixybukltmcorhvzpwg", // BitMEX - Yearly
				"dvytfuxeilgabhpcqknmjosrzw", // BitMEX
			],
		},
		website: "https://www.bitmex.com/register/vrkVRt",
	}

	function* account() {
		let params = {}
		params.currency = "all"

		let data = yield* get.call(this, "/user/margin", params)
		let balances = {}
		for (let i = 0; i < data.length; i++) {
			const item = data[i]
			const currency = item.currency.toUpperCase()

			balances[currency] = {
				available: item.availableMargin / 100000000,
				balance: item.marginBalance / 100000000
			}
		}

		return balances
	}

	function addRequestListener() {
		// BitMEX prevents JavaScript based requests via their X-Frame-Options header
		// Thus we need to capture and remove our "Origin" header
		if (state.addRequestListener) {
			state.addRequestListener = false

			chrome.webRequest.onBeforeSendHeaders.addListener(
				function (details) {
					for (let i = 0; i < details.requestHeaders.length; i++) {
						const header = details.requestHeaders[i]
						// Remove "Origin" header ONLY from Autoview's requests
						if (header.name === "Origin" && header.value.includes(chrome.runtime.id)) {
							details.requestHeaders.splice(i, 1);
							break;
						}
					}

					return {
						requestHeaders: details.requestHeaders
					}
				},
				{
					urls: [
						"https://*.bitmex.com/*"
					]
				},
				[
					"blocking",
					"requestHeaders"
				]
			)
		}

		return true
	}

	function* get(resource, query, headers) {
		query = query || {}

		if (query) {
			resource = resource + "?" + serialize(query).replace("%20", "+")
		}

		return yield* make.call(this, "GET", resource, null, headers)
	}

	function getContracts(symbol, balance, leverage, price, applyFee) {
		if (applyFee) {
			const takerFee = 0.075 / 100
			const fee = (takerFee * leverage) + (takerFee * leverage) // Entry + Exit
			const margin = balance * fee
			balance -= margin
		}
		let contracts = price < 1
			? Math.floor(balance * leverage / price)
			: Math.floor(balance * leverage * price)

		if (symbol === "ETHUSD") {
			contracts = Math.floor(balance * leverage / (price * 0.001 * 0.001))
		}

		return contracts
	}

	function* make(method, resource, parameters, headers) {
		parameters = parameters || {}

		headers = headers || {}

		resource = "/api/v1" + resource

		parameters = serialize(parameters).replace("%20", "+")

		const credentials = yield* this.getExchangeCredentials("private")
		const expires = Math.ceil(Date.now() / 1000) + 15 // seconds
		const data = method + resource + expires + parameters
		const endpoint = state.endpoint

		headers["api-expires"] = expires
		headers["api-key"] = credentials.public
		headers["api-signature"] = signature(credentials, data)

		resource = endpoint + resource

		addRequestListener()

		try {
			const func = method.toLowerCase() + "Request" // e.g. deleteRequest, postRequest
			const response = yield* this[func](resource, parameters, headers, "json")

			return response
		} catch (ex) {
			if (ex.hasOwnProperty("message")) {
				throw new Error(ex.message)
			}
			if (ex.hasOwnProperty("error")) {
				throw new Error(ex.error.message)
			}

			throw new Error("An unknown error has occurred.")
		}
	}

	function* ordersCancel(order) {
		let params = {}
		params.orderID = order.orderID

		return yield* make.call(this, "DELETE", "/order", params)
	}

	function* ordersCancelAll(Command) {
		let orders = yield* ordersOpen.call(this, Command)

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
					sortByIndex(orders, "orderQty")
					break
				case "biggest":
					sortByIndex(orders, "orderQty", true)
					break
				case "random":
					shuffle(orders)
			}
			orders = orders.slice(0, end)
		}

		if (Command.d) {
			console.log(this.getExchangeName(), "orders", orders)
			return false
		}

		for (let i = 0; i < orders.length; i++) {
			yield* ordersCancel.call(this, orders[i], Command)
		}
	}

	function* ordersOpen(Command) {
		const pair = symbolPair(Command.s)

		const market = yield* symbolInfo.call(this, pair.symbol)
		if (!market) {
			throw new ReferenceError("Ticker (" + pair.symbol + ") is not available.")
		}

		let filter = {}
		filter.open = true
		if (Command.b) {
			filter.side = Command.isBid ? "Buy" : "Sell"
		}
		if (Command.fp) {
			filter.price = Command.fp.resolve(market.precision)
		}

		let params = {}
		params.filter = JSON.stringify(filter)
		params.symbol = pair.symbol

		return yield* get.call(this, "/order", params)
	}

	function* positionsClose(Command, position) {
		const pair = symbolPair(Command.s)

		const market = yield* symbolInfo.call(this, pair.symbol)
		if (!market) {
			throw new ReferenceError("Ticker (" + pair.symbol + ") is not available.")
		}

		let first = ((Command.isBid && Command.t !== "market") || (Command.isAsk && Command.t === "market")) ? market.bidPrice : market.askPrice
		if (Command.sl || Command.tp || Command.ts) {
			first = position.avgCostPrice
		}
		let price = Command.p.relative(first).resolve(market.precision)
		if (Command.fp) {
			price = Command.fp.resolve(market.precision)
		}
		if (Command.u === "currency" && !Command.q.getIsPercent()) {
			const contracts = getContracts(pair.symbol, Command.q.resolve(8), position.leverage, price)
			Command.q = NumberObject(contracts)
		}
		const quantity = Command.q.reference(position.quantity).resolve(0)

		let params = {}
		params.execInst = Command.ro ? "ReduceOnly" : "Close"
		if (Command.t === "post") {
			params.execInst += ",ParticipateDoNotInitiate"
		}
		params.orderQty = quantity
		if (position.currentQty > 0) {
			params.orderQty *= -1
		}
		if (Command.hasOwnProperty("h")) {
			params.displayQty = Command.h.reference(quantity).resolve(0)
		}
		if (Command.t === "market") {
			params.ordType = "Market"
		} else {
			params.ordType = "Limit"
			params.price = price
		}
		if (Command.sl) {
			params.ordType = Command.t === "market" ? "Stop" : "StopLimit"
			params.stopPx = Command.sl.relative(position.avgCostPrice).resolve(market.precision)
			params.execInst += ",LastPrice" // MarkPrice, LastPrice, IndexPrice
		}
		if (Command.tp) {
			params.ordType = Command.t === "market" ? "MarketIfTouched" : "LimitIfTouched"
			params.stopPx = Command.tp.relative(position.avgCostPrice).resolve(market.precision)
			params.execInst += ",LastPrice" // MarkPrice, LastPrice, IndexPrice
		}
		if (Command.ts) {
			params.ordType = Command.t === "market" ? "Stop" : "StopLimit"
			params.pegPriceType = "TrailingStopPeg"
			params.pegOffsetValue = Command.ts.reference(position.avgCostPrice).resolve(market.precision)
			params.execInst += ",LastPrice" // MarkPrice, LastPrice, IndexPrice
		}
		params.symbol = position.symbol

		if (Command.lid) {
			params.clOrdLinkID = Command.lid
		}
		if (Command.oco) {
			params.clOrdLinkID = Command.oco
			params.contingencyType = "OneCancelsTheOther"
		}
		if (Command.oto) {
			params.clOrdLinkID = Command.oto
			params.contingencyType = "OneTriggersTheOther"
		}
		if (Command.ouoa) {
			params.clOrdLinkID = Command.ouoa
			params.contingencyType = "OneUpdatesTheOtherAbsolute"
		}
		if (Command.ouop) {
			params.clOrdLinkID = Command.ouop
			params.contingencyType = "OneUpdatesTheOtherProportional"
		}

		if (Command.d) {
			console.info(this.getExchangeName(), params)
			return false
		}

		const order = yield* post.call(this, "/order", params)

		return order
	}

	/**
	 * Note: One position per symbol
	 * @param Command
	 */
	function* positionsCloseAll(Command) {
		const pair = symbolPair(Command.s)

		let filter = {}
		filter.isOpen = true
		if (Command.l) {
			filter.leverage = Command.l
		}
		filter.symbol = pair.symbol

		let query = {}
		query.filter = JSON.stringify(filter)

		let positions = yield* get.call(this, "/position", query)

		positions = positions.filter((position) => {
			if (Command.isBid && position.currentQty < 0) {
				return false // Book mismatch
			}
			if (Command.isAsk && position.currentQty > 0) {
				return false // Book mismatch
			}

			position.quantity = Math.abs(position.currentQty)

			// Open orders in the opposite book "deduct" from a position's quantity
			if (position.currentQty > 0) {
				position.quantity -= position.openOrderSellQty
			} else {
				position.quantity -= position.openOrderBuyQty
			}

			if (position.quantity <= 0) {
				return false // Position allocated
			}

			return true
		})

		// Limit the number of closed positions by the requested "Close Maximum"
		const end = Command.cm.reference(positions.length).resolve(0)
		if (Command.cm.getMax() < positions.length) {
			switch (Command.cmo) {
				case "newest":
					sortByIndex(positions, "timestamp", true)
					break
				case "oldest":
					sortByIndex(positions, "timestamp")
					break
				case "lowest":
					sortByIndex(positions, "avgCostPrice")
					break
				case "highest":
					sortByIndex(positions, "avgCostPrice", true)
					break
				case "smallest":
					sortByIndex(positions, "quantity")
					break
				case "biggest":
					sortByIndex(positions, "quantity", true)
					break
				case "random":
					shuffle(positions)
			}
			positions = positions.slice(0, end)
		}

		for (let i = 0; i < positions.length; i++) {
			yield* positionsClose.call(this, Command, positions[i])
		}
	}

	function* post(resource, parameters, headers) {
		return yield* make.call(this, "POST", resource, parameters, headers)
	}

	function* setLeverage(symbol, leverage) {
		if (window.BITMEX_LEVERAGE === leverage) {
			return true
		}

		window.BITMEX_LEVERAGE = leverage

		let params = {}
		params.symbol = symbol
		params.leverage = leverage

		const response = yield* post.call(this, "/position/leverage", params)

		return response
	}

	function signature(credentials, data) {
		let sha = new jsSHA("SHA-256", "TEXT")
		sha.setHMACKey(credentials.private, "TEXT")
		sha.update(data)

		return sha.getHMAC("HEX")
	}

	function symbolPair(symbol) {
		symbol = symbol.toUpperCase()

		let so = {}
		so.main = ""
		so.pair = ""
		so.precision = 8
		so.symbol = symbol

		return so
	}

	function* symbolInfo(symbol) {
		let query = {}
		query.symbol = symbol

		let instrument = yield* get.call(this, "/instrument", query)
		if (instrument.length === 0) {
			throw new Error("Instrument '" + symbol + "' was not found.")
		}

		instrument = instrument.shift()
		instrument.precision = 0

		let tickSize = instrument.tickSize
		while (tickSize < 1) {
			instrument.precision++
			tickSize *= 10
		}
		// Precision does not dictate stepping
		if (tickSize !== 1) {
			instrument.precision += instrument.tickSize
		}

		return instrument
	}

	function testCommand() {
		const alert = Alert({
			desc: "d=1 b=buy q=1%",
			sym: "BITMEX:XBTUSD"
		})
		const commands = alert.commands
		const command = commands.shift()

		return command
	}

	function* trade(Command) {
		if (!Command.b) {
			throw new SyntaxError("Command [b]ook parameter is invalid.")
		}

		const pair = symbolPair(Command.s)
		const balances = yield* account.call(this)
		const currency = "XBT"
		if (!balances.hasOwnProperty(currency)) {
			throw new ReferenceError("Account Balance (" + currency + ") not available.")
		}

		const market = yield* symbolInfo.call(this, pair.symbol)
		if (!market) {
			throw new ReferenceError("Ticker (" + pair.symbol + ") is not available.")
		}

		const balance = balances[currency]
		const available = Command.y === "equity" ? balance.balance : balance.available
		const cross = Command.hasOwnProperty("l") && Command.l === 0
		const first = ((Command.isBid && Command.t !== "market") || (Command.isAsk && Command.t === "market")) ? market.bidPrice : market.askPrice
		let price = Command.p.relative(first).resolve(market.precision)
		if (Command.fp) {
			price = Command.fp.resolve(market.precision)
		}
		const leverage = cross ? 100 : Command.l || 1
		const contracts = getContracts(pair.symbol, available, leverage, price, true)
		let side = Command.isBid ? "Buy" : "Sell"
		let execInst = []

		let params = {}
		if (Command.t === "post") {
			execInst.push("ParticipateDoNotInitiate")
		}
		if (Command.ro) {
			execInst.push("ReduceOnly")
		}
		if (Command.u === "currency") {
			params.simpleOrderQty = Command.q.reference(available).resolve(market.precision) // e.g. BTC
		} else {
			params.orderQty = Command.q.reference(contracts).resolve(0) // Contracts
		}
		if (Command.hasOwnProperty("h")) {
			params.displayQty = Command.h.reference(contracts).resolve(0)
		}
		if (Command.t === "market") {
			params.ordType = "Market"
		} else {
			params.ordType = "Limit"
			params.price = price
		}
		if (Command.tp) {
			side = Command.isBid ? "Sell" : "Buy"
			params.ordType = Command.t === "market" ? "MarketIfTouched" : "LimitIfTouched"
			params.stopPx = Command.tp.relative(first).resolve(market.precision)
			execInst.push("LastPrice") // MarkPrice, LastPrice, IndexPrice
		}
		if (Command.sl) {
			side = Command.isBid ? "Sell" : "Buy"
			params.ordType = Command.t === "market" ? "Stop" : "StopLimit"
			params.stopPx = Command.sl.relative(first).resolve(market.precision)
			execInst.push("LastPrice") // MarkPrice, LastPrice, IndexPrice
		}
		if (Command.ts) {
			side = Command.isBid ? "Sell" : "Buy"
			params.ordType = Command.t === "market" ? "Stop" : "StopLimit"
			params.pegPriceType = "TrailingStopPeg"
			params.pegOffsetValue = Command.ts.reference(first).resolve(market.precision)
			execInst.push("LastPrice") // MarkPrice, LastPrice, IndexPrice
		}
		params.side = side
		params.symbol = pair.symbol
		if (execInst.length) {
			params.execInst = execInst.join(",")
		}

		if (Command.lid) {
			params.clOrdLinkID = Command.lid
		}
		if (Command.oco) {
			params.clOrdLinkID = Command.oco
			params.contingencyType = "OneCancelsTheOther"
		}
		if (Command.oto) {
			params.clOrdLinkID = Command.oto
			params.contingencyType = "OneTriggersTheOther"
		}
		if (Command.ouoa) {
			params.clOrdLinkID = Command.ouoa
			params.contingencyType = "OneUpdatesTheOtherAbsolute"
		}
		if (Command.ouop) {
			params.clOrdLinkID = Command.ouop
			params.contingencyType = "OneUpdatesTheOtherProportional"
		}

		if (Command.d) {
			console.info(this.getExchangeName(), params)
			return false // Disabled
		}

		// Adjust market leverage
		if (Command.hasOwnProperty("l")) {
			yield* setLeverage.call(this, pair.symbol, cross ? 0 : leverage)
		}

		const order = yield* post.call(this, "/order", params)

		return order
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
