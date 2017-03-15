
/**
 * complex types used in type checks throughout the library
 * @module types
 */

const typeforce = require('./typeforce')
const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const SIG = constants.SIG
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const types = exports

extend(exports, protocol.types)

exports.bufferOrString = typeforce.oneOf(typeforce.Buffer, typeforce.String)

// exports.hasRootHash = function hasPermalink (value) {
//   return !!value[PERMALINK]
// }

/**
 * @typedef {Object} identifier
 */
exports.identifier = function identifier (value) {
  if (!(value && typeof value === 'object')) return false

  var stringy = value.fingerprint || value.permalink || value.link
  if (stringy) return typeforce(typeforce.String, stringy)

  var pubKey = value.pubKey
  if (pubKey) {
    return pubKey.type === 'ec'
      ? typeforce(types.ecPubKey, pubKey)
      : typeforce(types.pubKey, pubKey)
  }

  return false
}

/**
 * @typedef {Object} pubKey
 */
exports.pubKey = typeforce.compile({
  fingerprint: typeforce.String,
  purpose: typeforce.String,
  type: typeforce.String,
  pub: typeforce.String,
  networkName: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {Object} identity
 */
exports.identity = function identity (value) {
  if (value[TYPE] !== constants.TYPES.IDENTITY) return false

  try {
    typeforce({
      pubkeys: typeforce.arrayOf(types.pubKey)
    }, value)
  } catch (err) {
    return false
  }

  return true
}

/**
 * @typedef {Object} transactor
 */
exports.transactor = typeforce.compile({
  send: typeforce.Function
})

/**
 * @typedef {Object|Function} leveldown
 */
exports.leveldown = typeforce.oneOf(typeforce.Object, typeforce.Function)

/**
 * @typedef {Object} changes
 */
exports.changes = typeforce.compile({
  append: typeforce.Function
})

/**
 * @typedef {Object} levelup
 */
exports.db = typeforce.compile({
  get: typeforce.Function,
  put: typeforce.Function,
  batch: typeforce.Function,
  createReadStream: typeforce.Function,
  close: typeforce.Function
})

// exports.logbase = typeforce.compile({
//   get: typeforce.Function,
//   put: typeforce.Function,
//   batch: typeforce.Function,
//   createReadStream: typeforce.Function,
//   close: typeforce.Function,
//   live: typeforce.compile({
//     get: typeforce.Function,
//     createReadStream: typeforce.Function
//   })
// })

/**
 * @typedef {Object} Keeper
 */
exports.keeper = types.db

/**
 * @typedef {Object} objectInfo
 */
exports.objectInfo = typeforce.compile({
  object: types.object,
  permalink: typeforce.String,
  link: typeforce.String,
  prevLink: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {Object} someObjectInfo
 */
exports.someObjectInfo = typeforce.compile({
  object: typeforce.maybe(types.signedObject),
  permalink: typeforce.maybe(typeforce.String),
  link: typeforce.maybe(typeforce.String),
  prevLink: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {Object} identityInfo
 */
exports.identityInfo = typeforce.compile({
  object: types.identity,
  permalink: typeforce.String,
  link: typeforce.String,
  prevLink: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {Object} Blockchain
 */
exports.blockchain = typeforce.compile({
  transactions: typeforce.compile({
    get: typeforce.Function
  }),
  addresses: typeforce.compile({
    transactions: typeforce.Function
  })
})

/**
 * @typedef {Object} seal
 */
exports.seal = typeforce.compile({
  basePubKey: types.chainPubKey,
  link: typeforce.String
})

exports.network = typeforce.compile({
  pubKeyToAddress: typeforce.Function,
  parseTx: typeforce.Function,
  constants: typeforce.Object,
  blockchain: exports.blockchain,
  transactor: exports.transactor
})

// exports.wrapper = typeforce.compile({
//   object: types.signedObject,
//   permalink: typeforce.String,
//   link: typeforce.String,
//   prevLink: typeforce.maybe(typeforce.String)
// })
