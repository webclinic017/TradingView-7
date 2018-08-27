"use strict"
/**
 *
 * @returns {*}
 * @constructor
 */
function Packages() {
	const packages = {
		BRONZE: {
			permissions: [
				"brnzhjdgkscloyiwtfupevmxaq", // Autoview Bronze
				"brnzvpskjlyxdewhoaguftcqmi", // Autoview Bronze - Yearly
			],
		},
		FREE: {
			permissions: [],
		},
	}

	return {
		getPackage: (name) => {
			if (!name) {
				throw new SyntaxError("Package Name is required")
			}
			if (!packages.hasOwnProperty(name)) {
				throw new ReferenceError("Invalid Package Name provided: " + name)
			}

			return packages[name]
		},
		getPackages: () => packages,
	}
}
