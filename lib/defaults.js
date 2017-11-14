/**
 * default settings
 * @module defaults
 */

// sync with blockchain interval

/**
 * @constant
 * @type {Number}
 * @default
 */
exports.syncInterval = 60 * 1000 * 1000 // 10 mins
// confirmations before a tx is taken off the watch list

/**
 * @constants
 * @type {Number}
 * @default
 */
exports.confirmedAfter = 10

exports.lockTimeout = 5000

exports.autoStart = true
