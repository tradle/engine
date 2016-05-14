
const typeforce = require('typeforce')
const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const CUR_HASH = constants.CUR_HASH

exports.bufferOrString = typeforce.oneOf(typeforce.Buffer, typeforce.String)

exports.hasRootHash = function (value) {
  return !!value[ROOT_HASH]
}

exports.identifier = function (value) {
  return value.fingerprint || value.pubKey || value[ROOT_HASH]
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
  [ROOT_HASH]: 'String',
  [CUR_HASH]: 'String',
  identity: exports.identity
})

exports.transactor = typeforce.compile({
  send: typeforce.Function
})

exports.leveldown = typeforce.oneOf(typeforce.Object, typeforce.Function)

exports.log = typeforce.Object

extend(exports, protocol.types)
