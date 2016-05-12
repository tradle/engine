'use strict'

const collect = require('stream-collector')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const putils = require('@tradle/protocol/lib/utils')

const utils = exports

exports.asyncify = putils.asyncify
exports.pubKeysAreEqual = putils.pubKeysAreEqual

exports.assert = fucntion (statement, msg) {
  if (!statement) throw new Error(msg || 'Assertion failed')
}

exports.find = function (arr, filter) {
  let match
  arr.some(function (item) {
    if (filter(item)) {
      match = item
      return true
    }
  })

  return match
}

exports.eqOpts = function (val) {
  return {
    lte: val,
    gte: val
  }
}

exports.hex = function hex (val) {
  return val.toString('hex')
}

exports.firstFromIndex = function firstFromIndex (indexDB, indexName, key, cb) {
  exports.getFromIndex(indexDB, indexName, key, function (err, results) {
    if (err) cb(err)
    cb(null, results[0])
  })
}

exports.getFromIndex = function getFromIndex (indexDB, indexName, key, cb) {
  collect(indexDB.createReadStream(indexName, exports.eqOpts(key)), cb)
}

exports.getWatchID = function getWatchID (opts) {
  typeforce({
    address: typeforce.String,
    link: types.bufferOrString
  }, opts)

  return `watch:${opts.address}:${utils.hex(opts.link)}`
}

exports.getSealID = function getSealID (opts) {
  typeforce({
    address: typeforce.String,
    toPubKey: typeforce.Buffer
  }, opts)

  return `seal:${opts.address}:${utils.hex(opts.toPubKey)}`
}

exports.getMsgID = function getMsgID (opts) {
  typeforce({
    link: types.bufferOrString,
    sender: typeforce.bufferOrString,
    recipient: typeforce.bufferOrString
  }, opts)

  return [
    'msg',
    utils.hex(opts.sender),
    utils.hex(opts.recipient),
    utils.hex(opts.link)
  ].join(':')
}

exports.augment = function augment (object, keeper, cb) {
  keeper.getOne(utils.hex(object.link))
    .then(function (obj) {
      object.object = obj
      cb(null, object)
    }, cb)
}

exports.sigKey = keys => utils.find(keys, isSigningKey)

exports.sigKeys = keys => keys.filter(isSigningKey)

exports.sigPubKey = function (identity) {
  const key = utils.find(identity.pubkeys, isSigningKey)
  return key && utils.toECKeyObj(key)
}

exports.sigPubKeys = identity => identity.pubkeys.filter(isSigningPubKey)

exports.chainPubKey = function chainPubKey (identity) {
  const key = utils.find(identity.pubkeys, isChainKey)
  return key && utils.toECKeyObj(key)
}

exports.chainPubKeys = identity => identity.pubkeys.filter(isChainPubKey)

exports.toECKeyObj = function toECKeyObj (key) {
  return {
    curve: key.curve,
    pub: new Buffer(key.value, 'hex')
  }
}

exports.hasPubKey = function (identity, pubKey) => {
  return identity.pubkeys.some(pk => {
    return utils.pubKeysAreEqual(pubKey, pk)
  })
}

exports.validateMessage = function (msg, from, to) {
  const senderPubKey = msg.senderPubKey
  const recipientPubKey = msg.recipientPubKey
  if (!utils.hasPubKey(from, senderPubKey)) {
    throw new Error('sender key not found')
  }

  if (!utils.hasPubKey(to, recipientPubKey)) {
    throw new Error('recipient key not found')
  }

  protocol.validateMessage({
    message: msg,
    senderPubKey: senderPubKey,
    recipientPubKey: recipientPubKey
    // TODO: msg.prev
  })
}

function isSigningKey (key) {
  return key.type() === 'ec' && key.get('purpose') === 'sign'
}

function isSigningPubKey (key) {
  return key.type === 'ec' && key.purpose === 'sign'
}

function isChainKey (key) {
  return key.type() === 'bitcoin' && key.get('purpose') === 'messaging'
}

function isChainPubKey (key) {
  return key.type === 'bitcoin' && key.purpose === 'messaging'
}
