const extend = require('extend/mutable')
const protocol = require('@tradle/protocol')

module.exports = extend({
  TYPES: {
    MESSAGE: 'tradle.Message',
    IDENTITY: 'tradle.Identity'
  },
  INDEX_SEPARATOR: '!'
}, protocol.constants)
