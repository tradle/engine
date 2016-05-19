
const typeforce = require('typeforce')
const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK

exports.bufferOrString = typeforce.oneOf(typeforce.Buffer, typeforce.String)

exports.hasRootHash = function (value) {
  return !!value[PERMALINK]
}

exports.identifier = function (value) {
  return value.fingerprint || value.pubKey || value[PERMALINK]
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
      pubkeys: typeforce.arrayOf(exports.pubKey)
    }, value)
  } catch (err) {
    return false
  }

  return true
}

exports.identityInfo = typeforce.compile({
  [PERMALINK]: 'String',
  [LINK]: 'String',
  identity: exports.identity
})

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

exports.logbase = typeforce.compile({
  get: typeforce.Function,
  put: typeforce.Function,
  batch: typeforce.Function,
  createReadStream: typeforce.Function,
  close: typeforce.Function,
  live: typeforce.compile({
    get: typeforce.Function,
    createReadStream: typeforce.Function
  })
})

exports.wrapper = typeforce.compile({
  objectDB: typeforce.Object,
  addressBook: typeforce.Object,
  keeper: types.keeper,
  identity: types.identity,
  object: typeforce.Object
})

exports.keeper = exports.db
exports.rawObject = typeforce.compile({
  [TYPE]: typeforce.String,
  [SIG]: typeforce.Null
})

exports.signedObject = typeforce.compile({
  [TYPE]: typeforce.String,
  [SIG]: typeforce.String
})

extend(exports, protocol.types)
