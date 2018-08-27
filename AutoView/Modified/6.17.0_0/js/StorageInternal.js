"use strict"
/**
 * Mimics Storage() abilities but directs requests to internal storage (i.e. background page)
 * @param {String} [storageArea]
 * @returns {*}
 * @constructor
 */
function StorageInternal(storageArea) {
	storageArea = storageArea || "sync"

	return {
		clearStorage: function* () {
			window.STORAGE[storageArea] = {}

			return true
		},
		getStorageValue: function* (...keys) {
			// Load existing
			const storage = window.STORAGE[storageArea] || {}
			// Find desired leaf
			const value = getObjectStack(storage, ...keys)

			return value
		},
		removeStorageValue: function* (...keys) {
			// Load existing
			let storage = yield* this.getStorageValue()
			// Remove desired leaf
			const result = removeObjectStack(storage, ...keys)

			return result
		},
		setStorageValue: function* (...keysEndWithValue) {
			// Load existing
			let storage = yield* this.getStorageValue()
			// Merge new value
			const append = setObjectStack(...keysEndWithValue)
			storage = Object.assignDeep({}, storage, append)
			// Store new data
			window.STORAGE[storageArea] = storage

			return storage
		},
	}
}
