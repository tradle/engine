'use strict'

const crypto = require('crypto') // maybe we only need createHash
const extend = require('xtend/mutable')
const clone = require('xtend')
const collect = require('stream-collector')
const typeforce = require('typeforce')
const PassThrough = require('readable-stream').PassThrough
const pump = require('pump')
const stringify = require('json-stable-stringify')
const bs58check = require('bs58check')
const async = require('async')
const levelup = require('levelup')
const hydration = require('hydration')
const protocol = require('@tradle/protocol')
const putils = require('@tradle/protocol/lib/utils')
const constants = require('./constants')
const topics = require('./topics')
const types = require('./types')
const networks = require('./networks')
const hydra = hydration()
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK

const utils = exports

;['omit', 'pick', 'asyncify', 'pubKeysAreEqual', 'assert'].forEach(method => {
  exports[method] = putils[method]
})

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

/**
 * convenience method for getting object body
 */
exports.getBody = function getBody (keeper, link, object, cb) {
  if (typeof object === 'function') {
    cb = object
    object = null
  }

  if (object) return cb(null, object)

  keeper.get(link, done)
}

exports.sealUID = function sealUID (opts) {
  typeforce({
    // address: typeforce.String,
    link: typeforce.String,
    basePubKey: typeforce.Buffer
  }, opts)

  return opts.link + ':' + utils.hex(opts.basePubKey)
}

exports.uid = function (opts) {
  const links = utils.getLinks(opts)
  return links.permalink + ':' + links.link

  // const object = opts.object
  // const link = utils.hexLink(opts.link || object)
  // const permalink = opts.permalink || object[PERMALINK] || link
  // return link + ':' + permalink
}

exports.prevUID = function (opts) {
  const links = utils.getLinks(opts)
  if (!links.prevlink) throw new Error('missing prevlink')

  return links.permalink + ':' + links.prevlink
}

exports.parseUID = function (uid) {
  const parts = uid.split(':')
  return {
    [PERMALINK]: parts[0],
    [LINK]: parts[1]
  }
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

exports.extend = extend
exports.clone = clone

exports.validateMessage = function (wrapper) {
  const msg = wrapper.object
  const from = wrapper.author
  const to = wrapper.identity
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

exports.stringify = stringify

exports.flatten = function (arr) {
  // flatten array of arrays
  return arr.reduce((flat, nextArr) => {
    return flat.concat(nextArr)
  }, [])
}

exports.stringToObject = str => rebuf(JSON.parse(str))

exports.opToBatch = function (op) {
  return op.batch ? op.batch : [op.value]
}

exports.prefixKey = function (prefix, key) {
  var sep = '!'
  // support passing in sublevel directly
  prefix = prefix.db ?
    prefix.db.prefix :
    sep + prefix + sep

  return prefix + key
}

exports.addLiveMethods = function (db, processor) {
  db.live = utils.liveMethods(db, processor)
  return db
}

exports.encodeBatch = function encodeBatch (rawBatch) {
  return rawBatch.map(utils.encodeRow)
}

exports.encodeOpts = function (db, opts) {
  ;['lt', 'lte', 'gt', 'gte', 'start', 'end'].forEach(prop => {
    if (opts[prop]) opts[prop] = utils.prefixKey(db, opts[prop])
  })

  return opts
}

exports.encodeRow = function encodeRow (row) {
  const encoded = {
    type: row.type,
    key: row.db ? utils.prefixKey(row.db, row.key) : row.key
  }

  if (row.value) encoded.value = row.value

  return encoded

  // const codec = row.db && getLevelCodec(row.db)
  // return {
  //   type: row.type,
  //   key: row.db ? codec.encodeKey(row.key) : row.key,
  //   value: row.db ? codec.encodeValue(row.value) : row.value,
  // }
}

exports.liveMethods = function liveMethods (db, processor) {
  return {
    createReadStream: function (opts) {
      return utils.upToDateStream(db, processor, opts)
    },
    get: function get () {
      const args = arguments
      processor.onLive(() => db.get.apply(db, args))
    }
  }
}


exports.upToDateStream = function (db, processor, opts) {
  opts = opts || {}

  var paused = new PassThrough({ objectMode: true })
  var rs
  paused.destroy = function () {
    if (rs) rs.destroy()
    else this.end()
  }

  paused.pause()
  processor.onLive(function () {
    const method = opts.live ? 'liveStream' : 'createReadStream'
    rs = db[method].call(db, opts)
    pump(
      rs,
      paused
    )

    paused.resume()
  })

  return paused
}

exports.pubKeyToAddress = function pubKeyToAddress (pubKey, networkName) {
  typeforce(typeforce.Buffer, pubKey.pub)

  const network = networks[networkName]
  if (!network) throw new Error('invalid "networkName"')

  let hash = crypto.createHash('sha256').update(pubKey.pub).digest()
  hash = crypto.createHash('ripemd160').update(hash).digest()

  const version = network.pubKeyHash
  let payload = new Buffer(21)
  payload.writeUInt8(version, 0)
  hash.copy(payload, 1)

  return bs58check.encode(payload)
}

exports.getLinks = function getLinks (wrapper) {
  typeforce({
    object: typeforce.maybe(types.signedObject),
    permalink: typeforce.maybe(typeforce.String),
    link: typeforce.maybe(typeforce.String),
    prevlink: typeforce.maybe(typeforce.String)
  }, wrapper)

  const object = wrapper.object
  const links = {
    link: wrapper.link || (object && utils.hexLink(object)),
    prevlink: wrapper.prevlink || (object && object[PREVLINK]),
    permalink: wrapper.permalink || (object && object[PERMALINK]) || wrapper.link
  }

  if (!links.permalink && links.prevlink) {
    throw new Error('expected "permalink"')
  }

  return links
}

exports.addLinks = function addLinks (wrapper) {
  return utils.extend(wrapper, utils.getLinks(wrapper))
}

exports.addPrev = function addPrev (wrapper, db, cb) {
  if (wrapper.prev) return cb()
  if (!wrapper.object[PREVLINK]) return cb()

  const uid = utils.prevUID(wrapper)
  db.get(uid, function (err, prev) {
    if (err) return cb(err)

    wrapper.prev = prev
    cb()
  })
}

exports.xor = function (a, b) {
  if (typeof a !== 'number') a = a ? 1 : 0
  if (typeof b !== 'number') b = b ? 1 : 0

  return a ^ b
}

// exports.addAuthors = function addAuthors (wrappers, addressBook, cb) {
//   async.each(wrappers, function iterator (wrapper, done) {
//     utils.addAuthor(wrapper, addressBook, done)
//   }, cb)
// }

exports.addAuthor = function addAuthor (wrapper, addressBook, cb) {
  utils.lookupAuthor(wrapper, addressBook, function (err, identityInfo) {
    if (err) return cb(err)

    wrapper.author = identityInfo
    cb()
  })
}

exports.lookupAuthor = function lookupAuthor (wrapper, addressBook, cb) {
  if (wrapper.author && wrapper.author.identity) cb()

  addressBook.lookupIdentity(wrapper.author, cb)
}

exports.loadBG = function loadBG (wrapper, cb) {
  utils.addLinks(wrapper)

  const tasks = [
    utils.addAuthor.bind(utils, wrapper, wrapper.addressBook),
    utils.addPrev.bind(utils, wrapper, wrapper.objectDB)
  ]

  async.parallel(tasks, cb)
}

exports.verifyAuthor = function verifyAuthor (wrapper, cb) {
  const signingKey = protocol.sigPubKey(object[SIG])
  if (!signingKey) throw new Error('bad signature')

  // key encoding should really be recorded in each key in an identity
  signingKey.value = utils.hex(signingKey.value)
  const hasKey = wrapper.author.identity.pubkeys.some(function (key) {
    for (let p in signingKey) {
      if (signingKey[p] !== key[p]) {
        return false
      }
    }

    return true
  })

  if (!hasKey) throw new Error('wrong author')
}

exports.execAsync = function (fn, cb) {
  try {
    cb(null, fn())
  } catch (err) {
    cb(err)
  }
}

exports.saveToKeeper = function saveToKeeper (keeper, wrappers, cb) {
  const batch = wrappers.map(w => {
    return {
      type: 'put',
      key: w[LINK],
      value: w.object
    }
  })

  keeper.batch(batch, cb)
}

exports.mapToBatch = function (map, op) {
  op = op || 'put'
  return Object.keys(map).map(key => {
    return {
      type: op,
      key: key,
      value: map[key]
    }
  })
}

exports.values = function (obj) {
  return Object.keys(obj).map(key => obj[key])
}

exports.now = function () {
  // later, we might want some high-res timestamp
  return Date.now()
}

exports.sealAddress = function sealAddress (basePubKey, link) {
  const pubKey = protocol.sealPubKey({
    link: link,
    basePubKey: basePubKey
  })

  return utils.pubKeyToAddress(pubKey)
}

exports.defaultValueEncoding = {
  encode: val => JSON.stringify(hydra.dehydrate(val)),
  decode: str => hydra.hydrate(JSON.parse(str))
}

exports.levelup = function (path, opts) {
  opts = opts || {}
  if (!opts.valueEncoding) {
    opts.valueEncoding = utils.defaultValueEncoding
  }

  return levelup(path, opts)
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
