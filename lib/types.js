
const typeforce = require('typeforce')
const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const SIG = constants.SIG
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const types = exports

exports.bufferOrString = typeforce.oneOf(typeforce.Buffer, typeforce.String)

exports.hasRootHash = function (value) {
  return !!value[PERMALINK]
}

exports.identifier = function (value) {
  return value.fingerprint || value.pubKey || value.link || value.permalink
}

exports.pubKey = typeforce.compile({
  fingerprint: typeforce.String,
  purpose: typeforce.String,
  type: typeforce.String,
  pub: typeforce.String,
  networkName: typeforce.maybe(typeforce.String)
})

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

exports.leveldown = typeforce.oneOf(typeforce.Object, typeforce.Function)

exports.changes = typeforce.compile({
  append: typeforce.Function
})

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

exports.keeper = types.db

exports.objectInfo = typeforce.compile({
  object: types.object,
  permalink: typeforce.String,
  link: typeforce.String,
  prevLink: typeforce.maybe(typeforce.String)
})

exports.identityInfo = typeforce.compile({
  object: types.identity,
  permalink: typeforce.String,
  link: typeforce.String,
  prevLink: typeforce.maybe(typeforce.String)
})

exports.blockchain = typeforce.compile({
  transactions: typeforce.compile({
    get: typeforce.Function
  }),
  addresses: typeforce.compile({
    transactions: typeforce.Function
  })
})

// exports.wrapper = typeforce.compile({
//   object: types.signedObject,
//   permalink: typeforce.String,
//   link: typeforce.String,
//   prevLink: typeforce.maybe(typeforce.String)
// })

extend(exports, protocol.types)
