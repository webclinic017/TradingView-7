"use strict"
/**
 *
 * @param {String} [storageArea]
 * @returns {*}
 * @constructor
 */
function Storage(storageArea) {
	storageArea = storageArea || "sync"

	function storageClear(callback) {
		const chromeCallback = chrome_callback.bind(this, callback)
		chrome.storage[storageArea].clear(chromeCallback)
	}

	function storageGet(keys, callback) {
		const chromeCallback = chrome_callback.bind(this, callback)
		chrome.storage[storageArea].get(keys, chromeCallback)
	}

	function storageSet(data, callback) {
		const chromeCallback = chrome_callback.bind(this, callback)
		chrome.storage[storageArea].set(data, chromeCallback)
	}

	return {
		clearStorage: function* () {
			yield storageClear.bind(this)

			return true
		},
		getStorageValue: function* (...keys) {
			// Load existing
			const stored = yield storageGet.bind(this, null)
			// Find desired leaf
			const value = getObjectStack(stored, ...keys)

			return value
		},
		removeStorageValue: function* (...keys) {
			// Load existing
			let stored = yield storageGet.bind(this, null)
			// Remove desired leaf
			const result = removeObjectStack(stored, ...keys)
			if (result) {
				// Save upon successful leaf removal
				yield storageSet.bind(this, stored)
			}

			return result
		},
		setStorageValue: function* (...keysEndWithValue) {
			// Load existing
			const stored = yield storageGet.bind(this, null)
			// Merge new value
			const append = setObjectStack(...keysEndWithValue)
			const storage = Object.assignDeep({}, stored, append)
			// Save
			yield storageSet.bind(this, storage)

			return storage
		},
	}
}
