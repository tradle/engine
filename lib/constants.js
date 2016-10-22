
/**
 * @module constants
 * @augments tradle/protocol/lib/constants
 */

const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')

module.exports = extend({
  /**
   * @constant
   * @type {string}
   * @default
   */
  MESSAGE_TYPE: 'tradle.Message',
  /**
   * @constant
   * @type {string}
   * @default
   */
  PREV_TO_SENDER: '_q',
  /**
   * @constant
   * @type {string}
   * @default
   */
  SEQ: '_n',
  /**
   * @constant
   * @type {Object}
   * @default
   */
  IDENTITY_VERSIONING_KEY: {
    purpose: 'update'
  },
  /**
   * @constant
   * @type {Object}
   * @default
   */
  TYPES: {
    MESSAGE: 'tradle.Message',
    IDENTITY: 'tradle.Identity'
  },
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
  watchType: {
    thisVersion: 't',
    nextVersion: 'n'
  },
  /**
   * @constant
   * @type {Object}
   * @default
   */
  DEFAULT_BACKOFF_OPTS: {
    initialDelay: 1000,
    maxDelay: 60000
  },

  ENTRY_PROP: '_'
}, protocol.constants)
