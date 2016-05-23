const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')

module.exports = extend({
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
  }
}, protocol.constants)
