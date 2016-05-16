'use strict'

const collect = require('stream-collector')
const typeforce = require('typeforce')
const protocol = require('@tradle/protocol')
const putils = require('@tradle/protocol/lib/utils')
const constants = require('@tradle/constants')
const topics = require('./topics')
const ROOT_HASH = constants.ROOT_HASH
const CUR_HASH = constants.CUR_HASH

const utils = exports

exports.asyncify = putils.asyncify
exports.pubKeysAreEqual = putils.pubKeysAreEqual

exports.assert = function (statement, msg) {
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
    if (!results.length) cb(utils.notFoundErr())
    else cb(null, results[0])
  })
}

exports.notFoundErr = function notFoundErr () {
  const err = new Error('NotFound')
  err.notFound = true
  return err
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
  const key = utils.find(identity.pubkeys, isSigningPubKey)
  return key && utils.toECKeyObj(key)
}

exports.sigPubKeys = identity => identity.pubkeys.filter(isSigningPubKey)

exports.chainPubKey = function chainPubKey (identity) {
  const key = utils.find(identity.pubkeys, isChainPubKey)
  return key && utils.toECKeyObj(key)
}

exports.chainPubKeys = identity => identity.pubkeys.filter(isChainPubKey)

exports.toECKeyObj = function toECKeyObj (key) {
  return {
    curve: key.curve,
    pub: new Buffer(key.value, 'hex')
  }
}

exports.hasPubKey = function (identity, pubKey) {
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

exports.hexLink = function (object) {
  return utils.hex(protocol.link(object))
}

exports.linkToBuf = function (link) {
  return Buffer.isBuffer(link) ? link : new Buffer(link, 'hex')
}

exports.toBuffer = function (obj, enc) {
  return Buffer.isBuffer(obj) ? obj :
    typeof obj === 'string' ? new Buffer(obj, enc) :
      new Buffer(JSON.stringify(obj), enc)
}

exports.flatten = function (arr) {
  // flatten array of arrays
  return arr.reduce((flat, nextArr) => {
    return flat.concat(nextArr)
  }, [])
}

exports.identityBatch = function (identity) {
  const curHash = utils.hexLink(identity)
  const rootHash = identity[ROOT_HASH] || curHash
  let batch = identity.pubkeys.map(key => {
    return [
      {
        type: 'put',
        key: 'pubkey:' + key.pub,
        value: {
          topic: topics.pubKey,
          pubKey: key.pub,
          [ROOT_HASH]: rootHash,
          [CUR_HASH]: curHash
        }
      },
      {
        type: 'put',
        key: 'fingerprint:' + key.fingerprint,
        value: {
          topic: topics.fingerprint,
          fingerprint: key.fingerprint,
          [ROOT_HASH]: rootHash,
          [CUR_HASH]: curHash
        }
      }
    ]
  })

  batch = utils.flatten(batch)
  if (curHash !== rootHash) {
    batch.push({
      type: 'put',
      key: CUR_HASH + ':' + curHash,
      value: {
        topic: topics.curHash,
        [CUR_HASH]: curHash,
        [ROOT_HASH]: rootHash
      }
    })
  }

  batch.push({
    type: 'put',
    key: 'contact:' + rootHash,
    value: {
      topic: topics.addcontact,
      [ROOT_HASH]: rootHash,
      [CUR_HASH]: curHash
    }
  })

  return {
    batch: batch,
    [CUR_HASH]: curHash,
    [ROOT_HASH]: rootHash
  }
}

exports.stringToObject = str => rebuf(JSON.parse(str))

exports.opToBatch = function (op) {
  return op.batch ? op.batch : [op.value]
}

exports.prefixKey = function (prefix, sep) {
  if (!sep) sep = '!'

  // support passing in sublevel directly
  prefix = prefix.db ? prefix.db.prefix : prefix
  return sep + prefix + sep + key
}

function rebuf (json) {
  if (Object.prototype.toString.call(json) !== '[object Object]') return json

  if (json &&
    json.type === 'Buffer' &&
    json.data &&
    !Buffer.isBuffer(json) &&
    Object.keys(json).length === 2) {
    return new Buffer(json.data)
  } else {
    for (var p in json) {
      json[p] = rebuf(json[p])
    }

    return json
  }
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
