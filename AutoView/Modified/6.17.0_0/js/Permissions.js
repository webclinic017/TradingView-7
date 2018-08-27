"use strict"
/**
 *
 * @param {*} state
 * @returns {*}
 * @constructor
 */
function Permissions(state) {
	function validateState(state) {
		state = state || {}
		if (!state.hasOwnProperty("origins")) {
			state.origins = []
		}
		if (!state.hasOwnProperty("permissions")) {
			state.permissions = []
		}

		return state
	}

	state = validateState(state)

	const self = {
		getLength: () => self.getOriginsLength() + self.getPermissionsLength(),
		getOriginsLength: () => state.origins.length,
		getPermissionsLength: () => state.permissions.length,
		grant: (grant) => {
			grant = self.validateState(grant)
			let result = false

			for (let i = 0; i < grant.origins.length; i++) {
				const origin = grant.origins[i]
				if (!state.origins.includes(origin)) {
					state.origins.push(origin)
					result = true
				}
			}

			for (let i = 0; i < grant.permissions.length; i++) {
				const permission = grant.permissions[i]
				if (!state.permissions.includes(permission)) {
					state.permissions.push(permission)
					result = true
				}
			}

			return result
		},
		hasAll: (required) => {
			required = self.validateState(required)

			for (let i = 0; i < required.origins.length; i++) {
				const origin = required.origins[i]
				if (!state.origins.includes(origin)) {
					return false // Required Origin not found
				}
			}

			for (let i = 0; i < required.permissions.length; i++) {
				const permission = required.permissions[i]
				if (!state.permissions.includes(permission)) {
					return false // Required Permission not found
				}
			}

			return true // No objections
		},
		hasAny: (optional) => {
			optional = self.validateState(optional)

			for (let i = 0; i < optional.origins.length; i++) {
				const origin = optional.origins[i]
				if (state.origins.includes(origin)) {
					return true // Match found
				}
			}

			for (let i = 0; i < optional.permissions.length; i++) {
				const permission = optional.permissions[i]
				if (state.permissions.includes(permission)) {
					return true // Match found
				}
			}

			return false // No result
		},
		revoke: (revoke) => {
			revoke = self.validateState(revoke)
			let result = false

			for (let i = 0; i < revoke.origins.length; i++) {
				const origin = revoke.origins[i]
				const x = state.origins.indexOf(origin)
				if (x !== -1) {
					delete state.origins[x]
					result = true
				}
			}

			for (let i = 0; i < revoke.permissions.length; i++) {
				const permission = revoke.permissions[i]
				const x = state.permissions.indexOf(permission)
				if (x !== -1) {
					delete state.permissions[x]
					result = true
				}
			}

			return result
		},
		validateState: validateState,
	}

	return self
}
