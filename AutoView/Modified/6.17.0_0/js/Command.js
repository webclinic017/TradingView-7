"use strict"
/**
 *
 * @param {String} [raw]
 * @returns {*}
 * @constructor
 */
function Command(raw) {
	const parameters = {
		a: "Account",
		b: "Book",
		c: "Cancel / Close",
		cm: "Cancel / Close Maximum",
		cmo: "Cancel / Close Maximum Order",
		d: "Disabled",
		delay: "Delay",
		e: "Exchange",
		fp: "Fixed Price",
		h: "Hidden/Iceberg",
		l: "Leverage",
		lid: "Linking Identifier",
		oco: "One Cancels the Other",
		oto: "One Triggers the Other",
		ouoa: "One Updates the Other Absolute",
		ouop: "One Updates the Other Proportional",
		p: "Price",
		q: "Quantity",
		ro: "Reduce Only",
		s: "Symbol",
		shared: "Shared",
		sl: "Stop Loss",
		t: "order Type",
		tp: "Take Profit",
		ts: "Trailing Stop",
		u: "Unit",
		v: "Version",
		w: "Wallet",
		y: "Yield",
	}

	function normalize() {
		if (this.a && this.a.indexOf(",") > -1) {
			this.a = this.a.split(",")
		}

		if (this.b) {
			this.isAsk = false
			this.isBid = false
			this.isMarginTrading = false

			switch (this.b) {
				case "long":
					this.isMarginTrading = true
				case "bid":
				case "buy":
					this.isBid = true
					break

				case "short":
					this.isMarginTrading = true
				case "ask":
				case "sell":
					this.isAsk = true
			}
		}

		this.w = this.hasOwnProperty("w") ? this.w.split(",") : []
	}

	function parse(str, defaults) {
		if (typeof str !== "string") {
			throw new TypeError("Expecting parameter 1 to be a string: " + typeof str)
		}
		if (typeof defaults !== "object") {
			defaults = {}
		}

		const params = Object.assign({}, defaults) // detach reference
		const reg = /(?:^|\s)([a-z]+)=([^\s]+)/g

		if (!reg.test(str)) {
			return false // Invalid syntax
		}
		reg.lastIndex = 0 // Reset from .test()

		let match
		while (match = reg.exec(str)) {
			params[match[1]] = match[2]
		}

		for (const p in params) {
			if (!params.hasOwnProperty(p) || !parameters.hasOwnProperty(p)) {
				continue // Invalid parameter
			}

			set.call(this, p, params[p])
		}

		normalize.call(this)

		return true
	}

	/**
	 *
	 * @param p
	 * @param value
	 */
	function set(p, value) {
		switch (p) {
			// String, lowercase
			case "b":
			case "c":
			case "cmo":
			case "t":
			case "u":
			case "v":
			case "y":
				this[p] = value.toLowerCase()
				break

			// Boolean
			case "d":
			case "ro":
			case "shared":
				this[p] = value === "1"
				break

			// String, uppercase
			case "a":
			case "e":
			case "s":
			case "w":
				this[p] = value.toUpperCase()
				break

			// Numeric
			case "l":
				this[p] = Number(value)
				break

			// String Identifiers, uppercase
			case "lid":
			case "oco":
			case "oto":
			case "ouoa":
			case "ouop":
				this[p] = value.toUpperCase()
				break

			// Number / Percent
			case "cm":
			case "delay":
			case "fp":
			case "h":
			case "p":
			case "q":
			case "sl":
			case "tp":
			case "ts":
				this[p] = NumberObject(value)
				break

			// Relay
			default:
				this[p] = value
		}
	}

	/**
	 *
	 * @param {String} raw
	 * @param {Object} [defaults]
	 * @returns {Command[]}
	 */
	function parseRaw(raw, defaults) {
		const lines = raw.split(/[\n|]/)
		let commands = []

		lines.forEach((line) => {
			const command = Command()
			const result = command.parseCommand(line, defaults)

			if (result) {
				// Multiple parameters per option is supported externally only
				// Create a (new) command for each of the values (?:1 => 1:1)
				if (command.a instanceof Array) {
					command.a.forEach((account) => {
						let cmd = Object.assign(Command(), command)
						cmd.a = account

						commands.push(cmd)
					})
				} else {
					commands.push(command)
				}
			}
		})

		return commands
	}


	const self = {
		getCommandParameters: parameters,
		isAsk: false,
		isBid: false,
		isMarginTrading: false,
		parseCommand: parse,
		parseRaw: parseRaw,
		setParameter: set,
	}

	if (raw) {
		self.parseCommand(raw)
	}

	return self
}
