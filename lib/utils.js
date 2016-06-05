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
const subdown = require('subleveldown')
const through = require('through2')
const levelup = require('levelup')
const levelErrors = require('level-errors')
const LiveStream = require('level-live-stream')
const hydration = require('hydration')
const mutexify = require('mutexify')
const bitcoin = require('@tradle/bitcoinjs-lib')
const kiki = require('@tradle/kiki')
const protocol = require('@tradle/protocol')
const putils = require('@tradle/protocol/lib/utils')
const constants = require('./constants')
const topics = require('./topics')
const types = require('./types')
const networks = require('./networks')
const hydra = hydration()
const DEFAULT_CURVE = 'p256'
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const SIG = constants.SIG

const utils = exports

;['omit', 'pick', 'asyncify', 'ecPubKeysAreEqual', 'assert', 'sign'].forEach(method => {
  utils[method] = putils[method]
})

utils.find = function (arr, filter) {
  let match
  arr.some(function (item) {
    if (filter(item)) {
      match = item
      return true
    }
  })

  return match
}

utils.eqOpts = function (val) {
  return {
    lte: val,
    gte: val
  }
}

utils.hex = function hex (val) {
  return val.toString('hex')
}

utils.noop = function noop () {}
utils.mergeStreams = require('./mergestreams')

utils.notFoundErr = function notFoundErr () {
  return new levelErrors.NotFoundError()
}

// utils.watchUID = function watchUID (opts) {
//   typeforce({
//     address: typeforce.String,
//     link: typeforce.String,
//     watchType: typeforce.String
//   }, opts)

//   return `watch:${opts.watchType}:${opts.address}:${opts.link}`
// }

// utils.addBody = function addBody (keeper, wrapper, link, cb) {
//   keeper.get(link, function (err, body) {
//     if (err) return cb(err)

//     wrapper.object = body
//     cb()
//   })
// }

// utils.getSealAddresses = function (seal) {
//   typeforce({
//     sealAddress: typeforce.String,
//     sealPrevAddress: typeforce.maybe(typeforce.String)
//   }, seal)

//   const arr = [seal.sealAddress]
//   if (seal.sealPrevAddress) arr.push(seal)

//   return arr
// }

// utils.sealUID = function sealUID (opts) {
//   typeforce({
//     link: typeforce.String,
//     networkName: typeforce.String,
//     sealAddress: typeforce.maybe(typeforce.String),
//     sealPrevAddress: typeforce.maybe(typeforce.String),
//     sealPubKey: typeforce.maybe(types.chainPubKey),
//     sealPrevPubKey: typeforce.maybe(types.chainPubKey)
//   }, opts)

//   const sealAddress = opts.sealAddress
//     || (opts.sealPubKey && utils.pubKeyToAddress(opts.sealPubKey, opts.networkName))
//     || ''

//   const sealPrevAddress = opts.sealPrevAddress
//     || (opts.sealPrevPubKey && utils.pubKeyToAddress(opts.sealPrevPubKey, opts.networkName))
//     || ''

//   if (!(sealAddress || sealPrevAddress)) throw Error('expeted "sealAddress" or "sealPrevAddress"')

//   return `seal:${opts.networkName}:${sealAddress}:${sealPrevAddress}:${opts.link}`
// }

utils.uid = function (opts) {
  const links = utils.getLinks(opts)
  return links.permalink + ':' + links.link

  // const object = opts.object
  // const link = utils.hexLink(opts.link || object)
  // const permalink = opts.permalink || object[PERMALINK] || link
  // return link + ':' + permalink
}

// utils.prevUID = function (opts) {
//   const links = utils.getLinks(opts)
//   if (!links.prevLink) throw new Error('missing prevLink')

//   return links.permalink + ':' + links.prevLink
// }

// utils.parseUID = function (uid) {
//   const parts = uid.split(':')
//   return {
//     [PERMALINK]: parts[0],
//     [LINK]: parts[1]
//   }
// }

// utils.getMsgID = function getMsgID (opts) {
//   typeforce({
//     link: types.bufferOrString,
//     sender: typeforce.bufferOrString,
//     recipient: typeforce.bufferOrString
//   }, opts)

//   return [
//     'msg',
//     utils.hex(opts.sender),
//     utils.hex(opts.recipient),
//     utils.hex(opts.link)
//   ].join(':')
// }

// utils.augment = function augment (wrapper, keeper, cb) {
//   keeper.get(utils.hex(wrapper.link), function (err, obj) {
//     if (err) return cb(err)

//     wrapper.object = obj
//     cb(null, wrapper)
//   })
// }

utils.sigKey = keys => utils.find(keys, isSigningKey)

// utils.sigKeys = keys => keys.filter(isSigningKey)

utils.sigPubKey = function (identity) {
  const key = utils.find(identity.pubkeys, isSigningPubKey)
  return key && utils.toECKeyObj(key)
}

// utils.sigPubKeys = identity => identity.pubkeys.filter(isSigningPubKey)

utils.chainKey = keys => utils.find(keys, isChainKey)

// utils.chainKeys = keys => keys.filter(isChainKey)

utils.chainPubKey = function chainPubKey (identity) {
  const key = utils.find(identity.pubkeys, isChainPubKey)
  return key && utils.toECKeyObj(key)
}

// utils.chainPubKeys = identity => identity.pubkeys.filter(isChainPubKey)

utils.toECKeyObj = function toECKeyObj (key) {
  return {
    curve: key.type === 'bitcoin' ? 'secp256k1' : key.curve,
    pub: new Buffer(key.pub, 'hex')
  }
}

utils.bindFunctions = function bindFunctions (obj) {
  for (let p in obj) {
    const val = obj[p]
    if (typeof val === 'function') {
      obj[p] = obj[p].bind(obj)
    }
  }

  return obj
}

utils.hasPubKey = function (identity, pubKey) {
  typeforce(types.identity, identity)
  typeforce({
    pub: types.bufferOrString
  }, pubKey)

  return identity.pubkeys.some(function (key) {
    for (let p in pubKey) {
      let pVal = pubKey[p]
      if (Buffer.isBuffer(pVal)) {
        // key encoding should really be recorded in each key in an identity
        pVal = pVal.toString('hex')
      }

      if (pVal !== key[p]) {
        return false
      }
    }

    return true
  })

  // return identity.pubkeys.some(pk => {
  //   return utils.ecPubKeysAreEqual(pubKey, pk)
  // })
}

utils.extend = extend
utils.clone = clone

// utils.validateMessage = function (wrapper) {
//   const msg = wrapper.object
//   const to = wrapper.recipient
//   const senderPubKey = msg.senderPubKey
//   const recipientPubKey = msg.recipientPubKey
//   if (!utils.hasPubKey(wrapper.author.object, senderPubKey)) {
//     throw new Error('sender key not found')
//   }

//   if (!utils.hasPubKey(to, recipientPubKey)) {
//     throw new Error('recipient key not found')
//   }

//   protocol.validateMessage({
//     message: msg,
//     // TODO: msg.prev
//   })
// }

utils.hexLink = function (object) {
  return utils.hex(protocol.link(object))
}

utils.linkToBuf = function (link) {
  return Buffer.isBuffer(link) ? link : new Buffer(link, 'hex')
}

// utils.toBuffer = function (obj, enc) {
//   return Buffer.isBuffer(obj) ? obj :
//     typeof obj === 'string' ? new Buffer(obj, enc) :
//       new Buffer(JSON.stringify(obj), enc)
// }

utils.stringify = stringify

// utils.filterStream = function (test) {
//   return through.obj(function (data, enc, cb) {
//     cb(null, test(data) ? data : null)
//   })
// }

// utils.flatten = function (arr) {
//   // flatten array of arrays
//   return arr.reduce((flat, nextArr) => {
//     return flat.concat(nextArr)
//   }, [])
// }

// utils.stringToObject = str => rebuf(JSON.parse(str))

utils.opToBatch = function (op) {
  return op.batch ? op.batch : [op.value]
}

// utils.prefixKey = function (prefix, key /*, forDB*/) {
//   var sep = '!'
//   // support passing in sublevel directly
//   prefix = prefix.db ?
//     prefix.db.prefix :
//     sep + prefix + sep

//   // if (forDB) {
//   //   const unprefix = forDB.db && forDB.db.prefix
//   //   if (unprefix) {
//   //     if (prefix.indexOf(unprefix) === -1) {
//   //       throw new Error('invalid forDB, expected an ancestor of db with provider prefix')
//   //     }

//   //     prefix = prefix.slice(unprefix.length)
//   //   }
//   // }

//   return prefix + key
// }

// utils.live = function (db, processor) {
//   typeforce(typeforce.Object, db)
//   typeforce(typeforce.Object, processor)

//   if (!db.liveStream) LiveStream.install(db)
//   db.live = utils.liveMethods(db, processor)
//   return db
// }

// utils.encodeBatch = function encodeBatch (rawBatch /*, forDB*/) {
//   return rawBatch.map(row => utils.encodeRow(row /*, forDB*/))
// }

// utils.encodeOpts = function (db, opts) {
//   ;['lt', 'lte', 'gt', 'gte', 'start', 'end'].forEach(prop => {
//     if (opts[prop]) opts[prop] = utils.prefixKey(db, opts[prop])
//   })

//   return opts
// }

// utils.encodeRow = function encodeRow (row /*, forDB*/) {
//   const encoded = {
//     type: row.type,
//     key: row.db ? utils.prefixKey(row.db, row.key /*, forDB*/) : row.key
//   }

//   if (row.value) encoded.value = row.value

//   return encoded

//   // const codec = row.db && getLevelCodec(row.db)
//   // return {
//   //   type: row.type,
//   //   key: row.db ? codec.encodeKey(row.key) : row.key,
//   //   value: row.db ? codec.encodeValue(row.value) : row.value,
//   // }
// }

// utils.liveMethods = function liveMethods (db, processor) {
//   return {
//     createReadStream: function (opts) {
//       return utils.upToDateStream(db, processor, opts)
//     },
//     get: function get () {
//       const args = arguments
//       processor.onLive(() => db.get.apply(db, args))
//     }
//   }
// }

// utils.setInterval = function (fn, millis, unref) {
//   const interval = setInterval(fn, millis)
//   if (unref && interval.unref) interval.unref()

//   return interval
// }

// utils.upToDateStream = function (db, processor, opts) {
//   opts = opts || {}
//   return utils.notReadyStream(function (cb) {
//     processor.onLive(function () {
//       const method = opts.live ? 'liveStream' : 'createReadStream'
//       const stream = db[method].call(db, opts)
//       cb(null, stream)
//     })
//   })
// }

// /**
//  * @param  {Function} fn function that calls back with a stream
//  */
// utils.notReadyStream = function (fn) {
//   var paused = new PassThrough({ objectMode: true })
//   var source
//   paused.destroy = function () {
//     if (source) rs.destroy()
//     else this.end()
//   }

//   paused.pause()

//   fn(function (err, stream) {
//     if (err) return paused.destroy()

//     source = stream
//     pump(source, paused)
//     paused.resume()
//   })

//   return paused
// }

// utils.uuid = function () {
//   return crypto.randomBytes(32).toString('hex')
// }

utils.sha256 = function (data) {
  return crypto.createHash('sha256').update(data).digest()
}

utils.pubKeyString = function (key) {
  typeforce(typeforce.Buffer, key.pub)

  return key.pub.toString('hex')
}

utils.pubKeyToAddress = function pubKeyToAddress (pubKey, networkName) {
  typeforce(typeforce.Buffer, pubKey.pub)

  const network = networks[networkName]
  if (!network) throw new Error('invalid "networkName": ' + networkName)

  let hash = utils.sha256(pubKey.pub)
  hash = crypto.createHash('ripemd160').update(hash).digest()

  const version = network.pubKeyHash
  let payload = new Buffer(21)
  payload.writeUInt8(version, 0)
  hash.copy(payload, 1)

  return bs58check.encode(payload)
}

utils.privToWIF = function (priv, networkName, compressed) {
  typeforce(typeforce.Buffer, priv)
  typeforce(typeforce.String, networkName)

  const network = networks[networkName]
  if (!network) throw new Error('invalid "networkName": ' + networkName)

  var bufferLen = compressed ? 34 : 33
  var buffer = new Buffer(bufferLen)

  buffer.writeUInt8(network.wif, 0)
  priv.copy(buffer, 1)

  if (compressed) {
    buffer.writeUInt8(0x01, 33)
  }

  return bs58check.encode(buffer)
}

utils.objectInfo = function objectInfo (wrapper) {
  const info = utils.getLinks(wrapper)
  info.object = wrapper.object
  return info
}

utils.getLinks = function getLinks (wrapper) {
  typeforce({
    object: typeforce.maybe(types.signedObject),
    permalink: typeforce.maybe(typeforce.String),
    link: typeforce.maybe(typeforce.String),
    prevLink: typeforce.maybe(typeforce.String)
  }, wrapper)

  const object = wrapper.object
  const link = wrapper.link || (object && utils.hexLink(object))
  const links = {
    link: link,
    permalink: wrapper.permalink || (object && object[PERMALINK]) || link
  }

  const prevLink = wrapper.prevLink || (object && object[PREVLINK])
  if (prevLink) links.prevLink = prevLink

  if (!links.permalink && links.prevLink) {
    throw new Error('expected "permalink"')
  }

  return links
}

utils.addLinks = function addLinks (wrapper) {
  return utils.extend(wrapper, utils.getLinks(wrapper))
}

utils.addPrev = function addPrev (node, wrapper, cb) {
  if (wrapper.prev) return cb()
  if (!wrapper.object[PREVLINK]) return cb()

  const uid = utils.prevUID(wrapper)
  db.get(uid, function (err, prev) {
    if (err) return cb(err)

    wrapper.prev = prev
    cb()
  })
}

// utils.xor = function (a, b) {
//   if (typeof a !== 'number') a = a ? 1 : 0
//   if (typeof b !== 'number') b = b ? 1 : 0

//   return a ^ b
// }

// utils.addAuthors = function addAuthors (wrappers, addressBook, cb) {
//   async.each(wrappers, function iterator (wrapper, done) {
//     utils.addAuthor(wrapper, addressBook, done)
//   }, cb)
// }

utils.addAuthor = function addAuthor (node, wrapper, cb) {
  utils.lookupAuthor(node, wrapper, function (err, objectInfo) {
    if (err) return cb(err)

    wrapper.author = objectInfo
    cb()
  })
}

utils.lookupAuthor = function lookupAuthor (node, wrapper, cb) {
  const author = wrapper.author
  if (author) {
    if (author.identity) {
      return cb(null, author)
    }

    if (author.link) {
      return node.addressBook.byLink(author.link, cb)
    }
  }

  const sigPubKey = utils.getSigPubKey(wrapper.object)
  node.addressBook.byPubKey(utils.pubKeyString(sigPubKey), cb)
}

utils.shortlink = function (link) {
  return link.slice(0, 6)
}

utils.subdebugger = function (debug, name) {
  return function () {
    utils.subdebug(debug, name, arguments)
  }
}

utils.subdebug = function (debug, name, args) {
  args = [].slice.call(args)
  args.unshift(name)
  return debug.apply(null, args)
}

utils.loadBG = function loadBG (node, wrapper, cb) {
  utils.addLinks(wrapper)

  const tasks = [
    taskCB => utils.addAuthor(node, wrapper, taskCB),
    taskCB => utils.addPrev(node, wrapper, taskCB),
  ]

  async.parallel(tasks, cb)
}

// utils.identityIndices = function identityIndices (identityInfo) {
//   typeforce(types.identityInfo, identityInfo)
//   const keys = identityInfo.object.pubkeys
//   return keys.map(key => key.pub)
//     .concat(keys.map(key => key.fingerprint))
//     .concat(identityInfo.link)
// }

utils.getSigPubKey = function (object) {
  const sig = object[SIG] || object
  return protocol.utils.parseSig(sig).pubKey
}

// utils.verifyAuthor = function verifyAuthor (wrapper) {
//   const signingKey = utils.getSigPubKey(wrapper.object)
//   if (!signingKey) throw new Error('bad signature')

//   // key encoding should really be recorded in each key in an identity
//   signingKey.pub = utils.hex(signingKey.pub)
//   const hasKey = wrapper.author.object.pubkeys.some(function (key) {
//     for (let p in signingKey) {
//       if (signingKey[p] !== key[p]) {
//         return false
//       }
//     }

//     return true
//   })

//   if (!hasKey) throw new Error('wrong author')
// }

// utils.execAsync = function (fn, cb) {
//   try {
//     var result = fn()
//   } catch (err) {
//     return cb(err)
//   }

//   cb(null, result)
// }

utils.saveToKeeper = function saveToKeeper (keeper, wrappers, cb) {
  const batch = wrappers.map(w => {
    return {
      type: 'put',
      key: w.link || w.object[LINK],
      value: w.object
    }
  })

  keeper.batch(batch, cb)
}

utils.mapToBatch = function (map, op) {
  op = op || 'put'
  return Object.keys(map).map(key => {
    return {
      type: op,
      key: key,
      value: map[key]
    }
  })
}

// utils.values = function (obj) {
//   return Object.keys(obj).map(key => obj[key])
// }

utils.now = function () {
  // later, we might want some high-res timestamp
  return Date.now()
}

utils.sealAddress = function sealAddress (basePubKey, link, networkName) {
  const pubKey = protocol.sealPubKey({
    link: utils.linkToBuf(link),
    basePubKey: basePubKey
  })

  return utils.pubKeyToAddress(pubKey, networkName)
}

utils.sealPrevAddress = function sealPrevAddress (basePubKey, link, networkName) {
  const pubKey = protocol.sealPrevPubKey({
    prevLink: utils.linkToBuf(link),
    basePubKey: basePubKey
  })

  return utils.pubKeyToAddress(pubKey, networkName)
}

utils.defaultValueEncoding = {
  encode: val => JSON.stringify(hydra.dehydrate(val)),
  decode: str => hydra.hydrate(JSON.parse(str))
}

utils.levelup = function (path, opts) {
  opts = opts || {}
  if (!opts.valueEncoding) {
    opts.valueEncoding = utils.defaultValueEncoding
  }

  return levelup(path, opts)
}

// utils.alphabetical = function alphabetical (a, b) {
//   return a < b ? -1 :
//     a > b ? 1 : 0
// }

utils.parseTx = function parseTx (txInfo, networkName) {
  // typeforce('String', txInfo.txHex)
  if (!(networkName in bitcoin.networks)) {
    throw new Error('invalid networkName')
  }

  var tx = txInfo.toHex ? txInfo : bitcoin.Transaction.fromHex(txInfo.txHex)
  return extend(txInfo, {
    from: utils.parseTxSender(tx, networkName),
    to: {
      addresses: utils.getOutputAddresses(tx, networkName)
    },
    confirmations: txInfo.confirmations || 0,
    txId: txInfo.txId || tx.getId(),
    txHex: txInfo.txHex || tx.toHex()
  })
}

utils.parseTxSender = function parseTxSender (tx, networkName) {
  const pubkeys = []
  const addrs = []
  tx.ins.map(function (input) {
    const pubKeyBuf = input.script.chunks[1]
    try {
      const pub = bitcoin.ECPubKey.fromBuffer(pubKeyBuf)
      const addr = pub.getAddress(bitcoin.networks[networkName]).toString()
      pubkeys.push(pubKeyBuf)
      addrs.push(addr)
    } catch (err) {}
  })

  return {
    pubkeys: pubkeys,
    addresses: addrs
  }
}

// utils.getTxAddresses = function getTxAddresses (tx, networkName) {
//   return utils.getInputAddresses(tx, networkName)
//     .concat(utils.getOutputAddresses(tx, networkName))
// }

utils.getOutputAddresses = function getOutputAddresses (tx, networkName) {
  return tx.outs.map(function (output) {
    return utils.getAddressFromOutput(output, networkName)
  })
  .filter(truthy)
}

utils.getAddressFromOutput = function getAddressFromOutput (output, networkName) {
  if (bitcoin.scripts.classifyOutput(output.script) === 'pubkeyhash') {
    return bitcoin.Address
      .fromOutputScript(output.script, bitcoin.networks[networkName])
      .toString()
  }
}

/**
 * monkey-patch `obj` to ensure async `methods` of `obj` never overlap
 * @return obj
 */
utils.lockify = function lockify (obj, methods) {
  const lock = mutexify()
  methods.forEach(method => {
    const orig = obj[method]
    obj[method] = function () {
      const args = [].slice.call(arguments)
      const cb = args[args.length - 1]
      let release
      args[args.length - 1] = function (err, val) {
        release(cb, err, val)
      }

      lock(function (_release) {
        release = _release
        orig.apply(obj, args)
      })
    }
  })

  return obj
}

utils.logify = function logify (obj, method, logArgs) {
  const orig = obj[method]
  obj[method] = function logifyProxy () {
    const result = orig.apply(obj, arguments)
    if (logArgs) console.log(method, 'args:', arguments)
    console.log(method, 'result:', result)
    return result
  }
}

utils.printStack = function () {
  try {
    throw new Error('')
  } catch (err) {
    console.error(err.stack)
  }
}

Object.defineProperty(utils, 'requiredKeys', {
  get: function () {
    return [
      { type: 'bitcoin', purpose: 'payment' },
      { type: 'bitcoin', purpose: 'messaging' },
      { type: 'ec', purpose: 'sign' },
      { type: 'ec', purpose: 'update' },
      { type: 'dsa', purpose: 'sign' }
    ]
  }
})

utils.defaultKeySet = function defaultKeySet (opts) {
  typeforce({
    networkName: 'String'
  }, opts)

  return utils.requiredKeys.map(function (k) {
    k = extend({}, k)
    if (k.type === 'bitcoin') {
      k.networkName = opts.networkName
    }

    if (k.type === 'ec' && !k.curve) {
      k.curve = DEFAULT_CURVE
    }

    return kiki.toKey(k, true) // gen a new one
  })
}


utils.newIdentity = function newIdentity (opts, cb) {
  typeforce({
    networkName: typeforce.String
  }, opts)

  const keys = utils.defaultKeySet({
    networkName: opts.networkName
  })

  const pub = {
    [TYPE]: constants.TYPES.IDENTITY,
    pubkeys: keys.map(k => k.exportPublic()).map(k => {
      k.pub = k.value
      return k
    })
  }

  const sigKey = utils.sigKey(keys)
  const sigPubKey = utils.sigPubKey(pub)
  protocol.sign({
    author: {
      sigPubKey: sigPubKey,
      sign: sigKey.sign.bind(sigKey)
    },
    object: pub
  }, err => {
    if (err) return cb(err)

    cb(null, {
      identity: pub,
      keys: keys.map(k => k.exportPrivate()),
      link: protocol.link(pub)
    })
  })
}

// function toBuffer (object) {
//   if (Buffer.isBuffer(object)) return object
//   if (typeof object === 'object') object = protocol.stringify(object)
//   if (typeof object === 'string') object = new Buffer(object)

//   return object
// }

function truthy (obj) {
  return !!obj
}

// function rebuf (json) {
//   if (Object.prototype.toString.call(json) !== '[object Object]') return json

//   if (json &&
//     json.type === 'Buffer' &&
//     json.data &&
//     !Buffer.isBuffer(json) &&
//     Object.keys(json).length === 2) {
//     return new Buffer(json.data)
//   } else {
//     for (var p in json) {
//       json[p] = rebuf(json[p])
//     }

//     return json
//   }
// }

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
