
/**
 * complex types used in type checks throughout the library
 * @module types
 */

const typeforce = require('./typeforce')
const extend = require('lodash/extend')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const {
  SIG,
  TYPE,
  PERMALINK,
  LINK,
} = constants

const types = exports

extend(exports, protocol.types)

exports.bufferOrString = typeforce.oneOf(typeforce.Buffer, typeforce.String)

// exports.hasRootHash = function hasPermalink (value) {
//   return !!value[PERMALINK]
// }

/**
 * @typedef {Object} identifier
 */
exports.identifier = typeforce.compile({
  permalink: typeforce.String
})

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
exports.blockchainReader = typeforce.compile({
  transactions: typeforce.compile({
    get: typeforce.Function
  }),
  addresses: typeforce.compile({
    transactions: typeforce.Function
  })
})

exports.blockchainAdapter = typeforce.compile({
  blockchain: typeforce.String,
  name: typeforce.String,
  pubKeyToAddress: typeforce.Function,
  minOutputAmount: typeforce.Number,
  createBlockchainAPI: typeforce.Function,
  createTransactor: typeforce.Function
})

/**
 * @typedef {Object} seal
 */
exports.seal = typeforce.compile({
  basePubKey: types.chainPubKey,
  link: typeforce.String
})

// exports.wrapper = typeforce.compile({
//   object: types.signedObject,
//   permalink: typeforce.String,
//   link: typeforce.String,
//   prevLink: typeforce.maybe(typeforce.String)
// })

exports.blockchainIdentifier = typeforce.compile({
  blockchain: typeforce.String,
  networkName: typeforce.String
})
