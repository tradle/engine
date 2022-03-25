const constants = require('@tradle/constants')

/**
 * @module constants
 * @augments tradle/constants
 */
module.exports = Object.freeze({
  ...constants,
  /**
   * @deprecated Use TYPES.MESSAGE
   */
  MESSAGE_TYPE: constants.TYPES.MESSAGE,
  /**
   * @constant
   * @type {Object}
   * @default
   */
  IDENTITY_VERSIONING_KEY: Object.freeze({
    purpose: 'update'
  }),
  /**
   * @constant
   * @type {string}
   * @default
   */
  INDEX_SEPARATOR: '!',
  /**
   * @constant
   * @type {Object}
   * @default
   */
  watchType: Object.freeze({
    thisVersion: 't',
    nextVersion: 'n'
  }),
  /**
   * @constant
   * @type {Object}
   * @default
   */
  DEFAULT_BACKOFF_OPTS: Object.freeze({
    initialDelay: 1000,
    maxDelay: 60000
  })
})
