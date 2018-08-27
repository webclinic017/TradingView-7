"use strict"
window.POLONIEX_NONCE = 0
window.POLONIEX_NONCE_OFFSET = -1
/**
 *
 * @returns {*}
 * @constructor
 */
function Poloniex() {
	let state = {
		aliases: [
			"POLONIEX",
		],
		endpoint: "https://poloniex.com/",
		fields: {
			public: {
				label: "API Key",
				message: "",
			},
			private: {
				label: "Secret",
				message: "",
			},
		},
		name: "Poloniex",
		patterns: [

		],
		permissions: {
			origins: [
				//"https://*.poloniex.com/*"
				"https://poloniex.com/*" // Backwards compatible (< 3.0.0)
			],
		},
		subscriptions: {
			active: [
				"brnzhjdgkscloyiwtfupevmxaq", // Autoview Bronze
				"brnzvpskjlyxdewhoaguftcqmi", // Autoview Bronze - Yearly
			],
			inactive: [
				"jdbctnilemusxowhazvfrkqgyp", // Poloniex
				"ibyhtgdsuoxrfqjcpakvwmnzel", // Poloniex - Yearly
				"qyvwjsemxdrtgkoifhuacnplzb", // Poloniex - Early Bird
			],
		},
		website: "https://poloniex.com/",
	}

	function* account(isMarginTrading) {
		let params = {}
		params.command = "returnCompleteBalances" // excludes "margin", "lending"
		const balances = yield* post.call(this, "/tradingApi", params)

		let available = {
			exchange: {},
			margin: {},
		}
		for (let symbol in balances) {
			if (balances.hasOwnProperty(symbol)) {
				let balance = balances[symbol]
				balances[symbol].balance = (Number(balance.available) + Number(balance.onOrders)).toFixed(8)

				available.exchange[symbol] = balances[symbol]
			}
		}

		if (isMarginTrading) {
			params.command = "returnTradableBalances"
			const tradable = yield* post.call(this, "/tradingApi", params)
			for (let symbol in tradable) {
				if (tradable.hasOwnProperty(symbol)) {
					// e.g. BTC_LTC => [BTC, LTC]; BTC is the same amount in each symbol
					const currency = symbol.split("_")[1]
					const balance = tradable[symbol][currency]
					if (available.exchange.hasOwnProperty(currency)) {
						available.exchange[currency].balance = (Number(available.exchange[currency].balance) + Number(balance)).toFixed(8)
					} else {
						available.exchange[currency] = {
							available: balance,
							balance: balance,
						}
					}
					available.margin[currency] = {
						available: balance,
						balance: balance,
					}
				}
			}
		}

		return available
	}

	function* get(resource, query) {
		resource = state.endpoint + resource.replace(/^\/+/, "")

		return yield* this.getRequest(resource, query, null, "json")
	}

	function* getNonce() {
		let nonce = Math.round(Date.now() / 1000) * 1000 // second precision

		if (window.POLONIEX_NONCE != nonce) {
			window.POLONIEX_NONCE_OFFSET = -1
		}

		window.POLONIEX_NONCE = nonce
		window.POLONIEX_NONCE_OFFSET++

		nonce += window.POLONIEX_NONCE_OFFSET

		return nonce
	}

	function* ordersCancel(order) {
		let params = {}
		params.command = "cancelOrder"
		params.orderNumber = order.orderNumber

		const response = yield* post.call(this, "/tradingApi", params)

		return response.success === 1
	}

	function* ordersCancelAll(Command) {
		const pair = symbolPair(Command.s)
		let orders = yield* ordersOpen.call(this, pair.symbol)

		orders = orders.filter((order) => {
			if (Command.b && Command.b !== order.type) {
				return false // buy, sell
			}
			if (Command.fp && Command.fp.compare(order.rate)) {
				return false // Price mismatch
			}

			return true
		})

		// Limit the number of cancelled orders by the requested "Cancel Maximum"
		const end = Command.cm.reference(orders.length).resolve(0)
		if (Command.cm.getMax() < orders.length) {
			switch (Command.cmo) {
				case "newest":
					sortByIndex(orders, "orderNumber", true)
					break
				case "oldest":
					sortByIndex(orders, "orderNumber")
					break
				case "lowest":
					sortByIndex(orders, "rate")
					break
				case "highest":
					sortByIndex(orders, "rate", true)
					break
				case "smallest":
					sortByIndex(orders, "amount")
					break
				case "biggest":
					sortByIndex(orders, "amount", true)
					break
				case "random":
					shuffle(orders)
			}
			orders = orders.slice(0, end)
		}

		for (let i = 0; i < orders.length; i++) {
			const order = orders[i]
			if (Command.d) {
				console.info(this.getExchangeName(), "Order", order.amount, "@", order.rate, "would be cancelled")
			} else {
				yield* ordersCancel.call(this, order)
			}
		}
	}

	function* ordersOpen(symbol) {
		let params = {}
		params.command = "returnOpenOrders"
		params.currencyPair = symbol

		return yield* post.call(this, "/tradingApi", params)
	}

	function* positionsClose(Command, position) {
		const pair = symbolPair(Command.s)

		const ticker = yield* symbolTicker.call(this, pair.symbol)
		if (!ticker) {
			throw new ReferenceError("Ticker (" + pair.symbol + ") is not available.")
		}

		const amount = Math.abs(position.amount)
		const first = ((Command.isBid && Command.t !== "market") || (Command.isAsk && Command.t === "market")) ? ticker.bid : ticker.ask
		let price = Command.p.relative(first).resolve(8)
		if (Command.fp) {
			price = Command.fp.resolve(8)
		}

		if (Command.u === "currency" && !Command.q.getIsPercent()) {
			Command.q.div(price)
		}
		const quantity = Command.q.reference(amount).resolve(8)

		let params = {}
		params.amount = quantity
		params.currencyPair = pair.symbol
		switch (Command.t) {
			case "fok":
				params.fillOrKill = 1
				break
			case "ioc":
				params.immediateOrCancel = 1
				break
			case "post":
				params.postOnly = 1
		}
		params.rate = price
		params.command = position.type === "long" ? "marginSell" : "marginBuy" // short, long

		if (Command.d) {
			console.info(this.getExchangeName(), params)
			return false // Disabled
		}

		return yield* post.call(this, "/tradingApi", params)
	}

	function* positionsCloseAll(Command) {
		const pair = symbolPair(Command.s)
		let positions = yield* positionsOpen.call(this, pair.symbol)

		positions = positions.filter((position) => {
			if (position.type === "none") {
				return false // Remove placeholder
			}
			if (Command.b && Command.b !== position.type) {
				return false // long, short; Book mismatch
			}
			if (pair.symbol !== position.symbol) {
				return false // Market mismatch
			}

			return true
		})

		// Limit the number of closed positions by the requested "Close Maximum"
		const end = Command.cm.reference(positions.length).resolve(0)
		if (Command.cm.getMax() < positions.length) {
			switch (Command.cmo) {
				case "newest":
				case "oldest":
					console.warn("Close Maximum Order [" + Command.cmo + "] is currently not supported.")
					break
				case "lowest":
					sortByIndex(positions, "basePrice")
					break
				case "highest":
					sortByIndex(positions, "basePrice", true)
					break
				case "smallest":
					sortByIndex(positions, "amount")
					break
				case "biggest":
					sortByIndex(positions, "amount", true)
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

	function* positionsOpen(symbol) {
		let params = {}
		params.command = "getMarginPosition"
		params.currencyPair = "all"

		const response = yield* post.call(this, "/tradingApi", params)
		let positions = []

		// { MARKET: position, ... } => [ position, ... ]
		for (let currency in response) {
			if (response.hasOwnProperty(currency)) {
				let position = response[currency]
				position.symbol = currency

				positions.push(position)
			}
		}

		return positions
	}

	function* post(resource, parameters) {
		resource = state.endpoint + resource.replace(/^\/+/, "")

		parameters = parameters || {}
		parameters.nonce = yield* getNonce()

		const credentials = yield* this.getExchangeCredentials("private")
		const signature = () => {
			let sha = new jsSHA("SHA-512", "TEXT")
			sha.setHMACKey(credentials.private, "TEXT")
			sha.update(serialize(parameters))

			return sha.getHMAC("HEX")
		}

		let headers = {}
		headers["Content-Type"] = "application/x-www-form-urlencoded"
		headers.Key = credentials.public
		headers.Sign = signature()

		try {
			const response = yield* this.postRequest(resource, parameters, headers, "json")

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

	function symbolPair(symbol) {
		symbol = symbol.toUpperCase()
		let reg
		let result
		let so = {}

		// Poloniex URL (e.g. https://poloniex.com/exchange#btc_pink)
		reg = /^(BTC|ETH|XMR|USDT)[-_/]?(.*?)$/i
		result = reg.exec(symbol)
		if (result) {
			so.main = result ? result[1] : ""
			so.pair = result ? result[2] : ""
		}

		// TradingView (e.g. POLONIEX:PINKBTC)
		reg = /^(.*?)[-_/]?(BTC|ETH|XMR|USDT)$/i
		result = reg.exec(symbol)
		if (result) {
			so.main = result ? result[2] : ""
			so.pair = result ? result[1] : ""
		}

		// Neither expression matches
		if (!so.main || !so.pair) {
			throw new Error("Unknown market symbol: " + symbol)
		}

		so.precision = 8
		so.symbol = so.main + "_" + so.pair

		return so
	}

	function* symbolTicker(symbol) {
		/**
		 *
		 * @param {{last, lowestAsk, highestBid, percentChange, baseVolume, quoteVolume, isFrozen, high24hr, low24hr}} ticker
		 * @returns {{active: boolean, ask: *, bid: *, high: *, last: *, low: *}}
		 */
		function normalizeTicker(ticker) {
			return {
				active: !ticker.isFrozen,
				ask: ticker.lowestAsk,
				bid: ticker.highestBid,
				high: ticker.high24hr,
				last: ticker.last,
				low: ticker.low24hr
			}
		}

		let query = {}
		query.command = "returnTicker"

		let tickers = yield* get.call(this, "/public", query)
		for (let currency in tickers) {
			if (tickers.hasOwnProperty(currency)) {
		 		tickers[currency] = normalizeTicker(tickers[currency])
			}
		}

		if (symbol) {
			if (!tickers.hasOwnProperty(symbol)) {
				return null
			}

			return tickers[symbol]
		}

		return tickers
	}

	function testCommand() {
		const alert = Alert({
			desc: "d=1 b=buy q=1%",
			sym: this.getExchangeName() + ":BTCUSDT"
		})
		const commands = alert.commands
		const command = commands.shift()

		return command
	}

	function* transferBalances(Command) {
		// Getting all non-zero balances (both -- margin and exchange)
		let params = {}
		params.command = "returnAvailableAccountBalances"
		const balances = yield* post.call(this, "/tradingApi", params)

		switch (Command.y) {
			case "margin": // spot => margin
				for (const currency in balances.exchange) {
					if (balances.exchange.hasOwnProperty(currency) && Command.w.includes(currency)) {
						const balance = balances.exchange[currency]
						const quantity = Command.q.reset().reference(balance)
						if (quantity.compare(0.0) !== 0) {
							yield* transferCoin.call(this, Command.y, currency, quantity.resolve(8), Command.d)
						}
					}
				}
				break

			case "spot": // margin => spot
				for (const currency in balances.margin) {
					if (balances.margin.hasOwnProperty(currency) && Command.w.includes(currency)) {
						const balance = balances.margin[currency]
						const quantity = Command.q.reset().reference(balance)
						if (quantity.compare(0.0) !== 0) {
							yield* transferCoin.call(this, Command.y, currency, quantity.resolve(8), Command.d)
						}
					}
				}
				break

			default:
				throw new SyntaxError("Wallet Account not found: " + Command.y)
		}
	}

	function* transferCoin(destination, currency, amount, debug) {
		const source = destination === "margin" ? "exchange" : "margin"

		let params = {}
		params.amount = amount
		params.command = "transferBalance"
		params.currency = currency
		params.fromAccount = source
		params.toAccount = destination === "margin" ? "margin" : "exchange"

		if (debug) {
			console.info(this.getExchangeName(), "Transferring", amount, currency, "from", source, "to", destination)
			return false // Disabled
		}

		return yield* post.call(this, "/tradingApi", params)
	}

	function* trade(Command) {
		if (!Command.b) {
			throw new SyntaxError("Command [b]ook parameter is invalid.")
		}

		const pair = symbolPair(Command.s)
		const balances = yield* account.call(this, Command.isMarginTrading)
		let currency = Command.isBid ? pair.main : pair.pair
		const wallet = Command.isMarginTrading ? "margin" : "exchange"

		if (Command.isMarginTrading) {
			currency = pair.pair
		}

		if (!balances.hasOwnProperty(wallet) || !balances[wallet].hasOwnProperty(currency)) {
			throw new ReferenceError("Account Balance (" + wallet + ", " + currency + ") not available.")
		}

		const ticker = yield* symbolTicker.call(this, pair.symbol)
		if (!ticker) {
			throw new ReferenceError("Ticker (" + pair.symbol + ") is not available.")
		}

		const balance = balances[wallet][currency]
		const first = ((Command.isBid && Command.t !== "market") || (Command.isAsk && Command.t === "market")) ? ticker.bid : ticker.ask
		let price = Command.p.relative(first).resolve(8)
		if (Command.fp) {
			price = Command.fp.resolve(8)
		}
		let available = Command.y === "equity" ? balance.balance : balance.available

		if (Command.isMarginTrading) {
			if (Command.u === "currency" && !Command.q.getIsPercent()) {
				Command.q.div(price)
			}
			Command.q.reference(available)
		} else {
			if (Command.isBid && Command.u !== "currency") {
				available /= price
				Command.q.reference(available)
			} else if (Command.u === "currency") {
				if (Command.isAsk) {
					available *= price
				}
				Command.q.reference(available)
				Command.q.div(price)
			} else {
				Command.q.reference(available)
			}
		}

		let params = {}
		params.amount = Command.q.resolve(8)
		params.currencyPair = pair.symbol
		switch (Command.t) {
			case "fok":
				params.fillOrKill = 1
				break
			case "ioc":
				params.immediateOrCancel = 1
				break
			case "post":
				params.postOnly = 1
		}
		params.rate = price
		if (Command.isMarginTrading) {
			params.command = Command.isBid ? "marginBuy" : "marginSell" // long, short
		} else {
			params.command = Command.isBid ? "buy" : "sell"
		}

		if (Command.d) {
			console.info(this.getExchangeName(), params)
			return false // Disabled
		}

		return yield* post.call(this, "/tradingApi", params)
	}


	return Object.assign(
		{},
		Exchange(state),
		{
			exchangeOrdersCancelAll: ordersCancelAll,
			exchangePositionsCloseAll: positionsCloseAll,
			exchangeTrade: trade,
			exchangeTransferBalances: transferBalances,
			getExchangeTestCommand: testCommand,
		}
	)
}
