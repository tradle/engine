const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')

module.exports = extend({
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
