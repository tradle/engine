
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
 * @typedef {identifier}
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
 * @typedef {pubKey}
 */
exports.pubKey = typeforce.compile({
  fingerprint: typeforce.String,
  purpose: typeforce.String,
  type: typeforce.String,
  pub: typeforce.String,
  networkName: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {identity}
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
 * @typedef {transactor}
 */
exports.transactor = typeforce.compile({
  send: typeforce.Function
})

/**
 * @typedef {leveldown}
 */
exports.leveldown = typeforce.oneOf(typeforce.Object, typeforce.Function)

/**
 * @typedef {changes}
 */
exports.changes = typeforce.compile({
  append: typeforce.Function
})

/**
 * @typedef {levelup}
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
 * @typedef {Keeper}
 */
exports.keeper = types.db

/**
 * @typedef {objectInfo}
 */
exports.objectInfo = typeforce.compile({
  object: types.object,
  permalink: typeforce.String,
  link: typeforce.String,
  prevLink: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {someObjectInfo}
 */
exports.someObjectInfo = typeforce.compile({
  object: typeforce.maybe(types.signedObject),
  permalink: typeforce.maybe(typeforce.String),
  link: typeforce.maybe(typeforce.String),
  prevLink: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {identityInfo}
 */
exports.identityInfo = typeforce.compile({
  object: types.identity,
  permalink: typeforce.String,
  link: typeforce.String,
  prevLink: typeforce.maybe(typeforce.String)
})

/**
 * @typedef {Blockchain}
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
 * @typedef {seal}
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
