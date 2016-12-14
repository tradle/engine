
/**
 * typeforce wrapper, disabled in production mode
 * @module typeforce
 */

const extend = require('xtend/mutable')
const typeforce = require('typeforce')
const debug = require('debug')('tradle:debug')

module.exports = extend(function typeforceWithDebug () {
  if (!debug.enabled) return typeforce.apply(typeforce, arguments)

  try {
    return typeforce.apply(typeforce, arguments)
  } catch (err) {
    debug('typecheck failed: ' + err.stack, arguments)
    throw err
  }
}, typeforce)
