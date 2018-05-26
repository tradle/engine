
/**
 * @module constants
 * @augments tradle/protocol/lib/constants
 */

const extend = require('lodash/extend')
const constants = require('@tradle/constants')
const { TYPES } = constants

const merged = extend({
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
  TYPES,
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
}, constants)

merged.TYPES = extend({
  MESSAGE: 'tradle.Message',
  IDENTITY: 'tradle.Identity',
  PARTIAL: 'tradle.Partial'
}, merged.TYPES)

module.exports = merged
