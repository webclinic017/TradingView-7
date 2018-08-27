"use strict"
/**
 *
 * @returns {*}
 * @constructor
 */
function TradingView() {
	let state = {
		permissions: {
			origins: [
				"https://*.tradingview.com/*"
			]
		},
		website: "https://www.tradingview.com/"
	}

	return Object.assign(
		{},
		StorageInternal("sync"),
		TradingViewListener(state),
		{
			getTradingViewAttribute: function* (attribute) {
				if (typeof attribute !== "string") {
					throw new TypeError("Invalid attribute provided: " + typeof attribute)
				}

				attribute = attribute.toUpperCase()
				return yield* this.getStorageValue("TRADINGVIEW", attribute)
			},

			getTradingViewTabs: function* () {
				const queryInfo = {
					url: state.permissions.origins
				}

				return yield tabs_query.bind(this, queryInfo)
			},

			reloadTradingViewTabs: function* () {
				const tabs = yield* this.getTradingViewTabs()

				for (let i = 0; i < tabs.length; i++) {
					const tab = tabs[i]
					if (tab.hasOwnProperty("id")) {
						console.info("Tab #%d reloaded.", tab.id)

						yield tabs_reload.bind(this, tab.id)
					}
				}
			},

			setTradingViewAttribute: function* (attribute, value) {
				if (typeof attribute !== "string") {
					throw new TypeError("Invalid attribute provided: " + typeof attribute)
				}

				attribute = attribute.toUpperCase()
				return yield* this.setStorageValue("TRADINGVIEW", attribute, value)
			}
		}
	)
}
