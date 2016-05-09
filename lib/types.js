
const typeforce = require('typeforce')
const extend = require('xtend/mutable')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
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
  fingerprint: 'String',
  purpose: 'String',
  type: 'String',
  value: 'String',
  networkName: '?String'
})

exports.identity = typeforce.compile({
  pubkeys: typeforce.arrayOf(exports.pubKey)
})

exports.identityInfo = typeforce.compile({
  [ROOT_HASH]: 'String',
  [CUR_HASH]: 'String',
  identity: exports.identity
})

extend(exports, protocol.types)
