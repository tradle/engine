const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')

module.exports = extend({
  MESSAGE_TYPE: 'tradle.Message',
  PREV_TO_SENDER: '_q',
  SEQ: '_n',
  FORWARD: '_f',
  IDENTITY_VERSIONING_KEY: {
    purpose: 'update'
  },
  TYPES: {
    MESSAGE: 'tradle.Message',
    IDENTITY: 'tradle.Identity'
  },
  INDEX_SEPARATOR: '!',
  docTypes: {
    object: 'o',
    seal: 's',
    tx: 't',
    watch: 'w'
  },
  watchType: {
    thisVersion: 't',
    nextVersion: 'n'
  },
  DEFAULT_BACKOFF_OPTS: {
    initialDelay: 1000,
    maxDelay: 60000
  }
}, protocol.constants)
