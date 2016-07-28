'use strict'

const crypto = require('crypto') // maybe we only need createHash
const extend = require('xtend/mutable')
const clone = require('xtend')
const collect = require('stream-collector')
const once = require('once')
const Stream = require('readable-stream')
const Readable = Stream.Readable
const PassThrough = Stream.PassThrough
const pump = require('pump')
const combine = require('stream-combiner2')
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
// const kiki = require('@tradle/kiki')
// const nkeyEC = require('nkey-ec')
// const nkeyDSA = require('nkey-dsa')
// const nkeyBitcoin = require('nkey-bitcoin')
const protocol = require('@tradle/protocol')
const putils = require('@tradle/protocol/lib/utils')
const schema = require('./proto').schema
const typeforce = require('./typeforce')
const constants = require('./constants')
const topics = require('./topics')
const types = require('./types')
const networks = require('./networks')
const head = require('./head')
const manifest = require('./manifest')
const hydra = hydration()
const DEFAULT_CURVE = 'p256'
const DEFAULT_NETWORK = 'testnet'
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const PREV_TO_SENDER = constants.PREV_TO_SENDER
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const SIG = constants.SIG
const SEQ = constants.SEQ

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

utils.mergeStreams = function mergeStreams (streams, compare) {
  const arr = []
  const out = new Readable({ objectMode: true })
  out._read = utils.noop
  let togo = streams.length
  streams.forEach(stream => {
    stream.on('end', done)
    stream.on('data', data => arr.push(data))
  })

  return out

  function done (cb) {
    if (--togo) return

    arr.sort(compare).forEach(out.push, out)
    out.push(null)
  }
}

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
  const key = utils.find(identity.pubkeys, isSigningKey)
  return key && utils.toECKeyObj(key)
}

utils.identityVersioningKey = keys => utils.find(keys, isIdentityVersioningKey)

utils.identityVersioningPubKey = function identityVersioningPubKey (identity) {
  const key = utils.find(identity.pubkeys, isIdentityVersioningKey)
  return key && utils.toECKeyObj(key)
}

// utils.sigPubKeys = identity => identity.pubkeys.filter(isSigningKey)

utils.chainKey = keys => utils.find(keys, isChainKey)

// utils.chainKeys = keys => keys.filter(isChainKey)

utils.chainPubKey = function chainPubKey (identity) {
  const key = utils.find(identity.pubkeys, isChainKey)
  return key && utils.toECKeyObj(key)
}

// utils.chainPubKeys = identity => identity.pubkeys.filter(isChainKey)

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

utils.findPubKey = function (identity, props) {
  typeforce(types.identity, identity)
  typeforce({
    pub: types.bufferOrString
  }, props)

  return utils.find(identity.pubkeys, key => {
    for (let p in props) {
      let pVal = props[p]
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
}

utils.hasPubKey = function (identity, props) {
  return !!utils.findPubKey(identity, props)
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

utils.filterStream = function (test) {
  return through.obj(function (data, enc, cb) {
    cb(null, test(data) ? data : null)
  })
}

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
  if (typeof key === 'string') return key

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
    permalink: wrapper.permalink || (object ? object[PERMALINK] || link : null)
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

utils.maybeAddPrev = function maybeAddPrev (node, wrapper, cb) {
  if (wrapper.prev) return cb()

  const prevLink = wrapper.object[PREVLINK]
  if (!prevLink) return cb()

  // const uid = utils.prevUID(wrapper)
  node.objects.get({ link: prevLink }, function (err, prev) {
    // if (err) return cb(err)

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
  if (author && typeof author === 'object') {
    if (author.identity) {
      return cb(null, author)
    }

    if (author.link) {
      return node.addressBook.byLink(author.link, cb)
    }
  }

  const sigPubKey = utils.claimedSigPubKey(wrapper.object)
  node.addressBook.byPubKey(utils.pubKeyString(sigPubKey), cb)
}

utils.shortlink = function (link) {
  return link.slice(0, 6)
}

utils.subdebugger = function (debug, name) {
  // accept `node` or string
  name = name && name.name || name
  typeforce(typeforce.String, name)
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
    taskCB => utils.maybeAddPrev(node, wrapper, taskCB),
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

utils.claimedSigPubKey = function (object) {
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

utils.defaultKeySet = function defaultKeySet (networkName) {
  networkName = networkName || DEFAULT_NETWORK
  const descriptors = [
    { type: 'bitcoin', purpose: 'payment', networkName: networkName },
    { type: 'bitcoin', purpose: 'messaging', networkName: networkName },
    { type: 'ec', purpose: 'sign', curve: 'p256' },
    { type: 'ec', purpose: 'update', curve: 'p256' },
    { type: 'dsa', purpose: 'sign' }
  ]

  return utils.generateKeySet(descriptors)
}

utils.generateKeySet = function generateKeySet (keys) {
  keys.forEach(key => typeforce({
    type: typeforce.String,
    purpose: typeforce.String
  }, key))

  return keys.map(k => {
    if (k.type === 'bitcoin' && !k.networkName) {
      k = utils.clone(k)
      k.networkName = DEFAULT_NETWORK
    }

    return utils.genKey(k).set('purpose', k.purpose)
  })
}

utils.genKey = function (json, cb) {
  const impl = utils.getKeyImplementation(json)
  return cb ? impl.gen(json, cb) : impl.genSync(json)
}

utils.getKeyImplementation = function (k) {
  const type = k.type
  switch (type) {
  case 'bitcoin':
    return require('nkey-bitcoin')
  case 'ec':
    return require('nkey-ec')
  case 'dsa':
    return require('nkey-dsa')
  default:
    throw new Error('unsupported key type: ' + type)
  }
}

utils.importKey = function (k) {
  if (typeof k.toJSON === 'function') return k

  return utils.getKeyImplementation(k).fromJSON(k)
}

utils.newIdentity = function newIdentity (opts, cb) {
  typeforce({
    networkName: typeforce.maybe(typeforce.String),
    keys: typeforce.maybe(typeforce.Array)
  }, opts)

  let keys
  if (opts.keys) {
    keys = utils.generateKeySet(opts.keys)
  } else {
    keys = utils.defaultKeySet(opts.networkName)
  }

  const privJSON = keys.map(k => k.toJSON(true))

  let pub = {
    [TYPE]: constants.TYPES.IDENTITY,
    pubkeys: keys.map(k => k.toJSON())
  }

  const sigKeyJSON = utils.identityVersioningKey(privJSON)
  const sigKey = keys[privJSON.indexOf(sigKeyJSON)]
  const sigPubKey = utils.identityVersioningPubKey(pub)
  protocol.sign({
    author: {
      sigPubKey: sigPubKey,
      sign: sigKey.sign.bind(sigKey)
    },
    object: pub
  }, function (err, result) {
    if (err) return cb(err)

    pub = result.object // signed
    cb(null, {
      identity: pub,
      keys: privJSON,
      link: protocol.linkString(pub)
    })
  })
}

// utils.signObject = function signObject (opts, cb) {
//   typeforce({
//     object: typeforce.oneOf(types.rawObject, types.signedObject),
//     key: typeforce.maybe(typeforce.Object),
//     keys: typeforce.maybe(typeforce.Array)
//   }, opts)

//   const object = protocol.body(opts.object)
//   let key = opts.key
//   if (!key) {
//     key = utils.find(opts.keys, key => {
//       if (object[TYPE] === constants.TYPES.IDENTITY) {
//         return isIdentityVersioningKey(key)
//       } else {
//         return isSigningKey(key)
//       }
//     })
//   }

//   key = utils.importKey(key)
//   protocol.sign({
//     sigPubKey: key.toJSON(),
//     object: object
//   }, function (err, result) {
//     if (err) return cb(err)

//     cb(null, result.object)
//   })
// }

// utils.versionIdentity = function versionIdentity (opts, cb) {
//   typeforce({
//     keys: typeforce.Array,
//     identity: types.identity,
//     prev: types.identity
//   }, opts)

//   const newIdentity = opts.identity
//   newIdentity[PREVLINK] = protocol.linkString(opts.prev)
//   newIdentity[PERMALINK] = opts.prev[PERMALINK] || newIdentity[PREVLINK]
//   utils.signObject({
//     keys: opts.keys,
//     object: newIdentity
//   }, cb)
// }

utils.signee = function signee (opts) {
  typeforce({
    permalink: typeforce.String,
    link: typeforce.String
  }, opts)

  return opts.permalink + ':' + opts.link
}

utils.firstInStream = function firstInStream (stream, cb) {
  cb = once(cb)
  combine.obj(
    stream,
    head(1)
  )
  .on('data', data => cb(null, data))
  .on('error', cb)
  .on('end', () => cb(utils.notFoundErr()))
}

utils.promisifyNode = function promisifyNode (node, promiseImpl) {
  if (node._promisified) return node

  const nodeManifest = manifest.node
  Object.keys(nodeManifest)
    .filter(method => nodeManifest[method].type === 'async')
    .forEach(method => {
      node[method] = utils.promisifyMethod(node, method, promiseImpl)
    })

  ;['objects', 'seals', 'watches', 'addressBook'].forEach(db => {
    const dbManifest = manifest[db]
    Object.keys(dbManifest)
      .filter(method => dbManifest[method].type === 'async')
      .forEach(method => {
        node[db][method] = utils.promisifyMethod(node[db], method, promiseImpl)
      })
  })

  node._promisified = true
  return node
}

utils.promisifyMethod = function (obj, method, promiseImpl) {
  const orig = obj[method]
  if (orig._promisified) return orig

  if (!promiseImpl) promiseImpl = Promise
  const promisified = function promisified () {
    if (typeof arguments[arguments.length - 1] === 'function') {
      return orig.apply(obj, arguments)
    }

    const args = Array.prototype.slice.call(arguments)
    return new promiseImpl((resolve, reject) => {
      args.push(function (err, val) {
        if (err) return reject(err)
        else resolve(val)
      })

      orig.apply(this, args)
    })
  }

  promisified._promisified = true
  return promisified
}

utils.timeout = function timeout (fn, millis, unref) {
  const t = setTimeout(fn, millis)
  if (unref && t.unref) t.unref()
  return t
}

utils.serializeMessage = function (msg) {
  var copy = {}
  var other = {}
  for (var p in msg) {
    var val = msg[p]
    switch (p) {
    case TYPE:
      break
    case 'recipientPubKey':
      copy[p] = val
      break
    case 'object':
      copy[p] = new Buffer(stringify(val))
      break
    case SIG:
      copy[p] = protocol.utils.parseSig(val)
      break
    case PREV_TO_SENDER:
      copy[p] = new Buffer(val, 'hex')
      break
    case 'seal':
      copy.seal = {
        network: val.network === 'testnet' ? schema.Network.btctest : schema.Network.btcmain,
        basePubKey: val.basePubKey,
        link: new Buffer(val.link, 'hex')
      }
      break
    default:
      other[p] = msg[p]
      break
    }
  }

  if (Object.keys(other).length) {
    copy.other = new Buffer(JSON.stringify(other))
  }

  return schema.Message.encode(copy)
}

utils.unserializeMessage = function (msg) {
  msg = schema.Message.decode(msg)
  utils.cleanupDecodedProtobuf(msg)

  for (var p in msg) {
    var val = msg[p]
    if (val == null) {
      delete msg[p]
      continue
    }

    switch (p) {
    case 'other':
      break
    case 'object':
      msg[p] = JSON.parse(val)
      break
    case SIG:
      msg[p] = protocol.utils.sigToString(protocol.utils.encodeSig(val))
      break
    case PREV_TO_SENDER:
      msg[p] = val.toString('hex')
      break
    case 'seal':
      val.network = val.network === schema.Network.btctest ? 'testnet' : 'bitcoin'
      val.link = val.link.toString('hex')
      break
    }
  }

  msg[TYPE] = constants.MESSAGE_TYPE
  if (msg.other) {
    utils.extend(msg, JSON.parse(msg.other))
    delete msg.other
  }

  return msg
}

var SERIALIZABLE_IDENTITY_PROPS = [
  TYPE, SIG, PERMALINK, PREVLINK, 'pubkeys'
]

utils.serializeIdentity = function (identity) {
  for (var p in identity) {
    if (SERIALIZABLE_IDENTITY_PROPS.indexOf(p) === -1) {
      throw new Error('identity not serializable')
    }
  }

  const formatted = {
    [SIG]: new Buffer(identity[SIG], 'base64'),
    pubkeys: identity.pubkeys.map(utils.toCompactPubKey)
  }

  if (identity[PERMALINK]) formatted[PERMALINK] = new Buffer(identity[PERMALINK], 'hex')
  if (identity[PREVLINK]) formatted[PREVLINK] = new Buffer(identity[PREVLINK], 'hex')

  return schema.Identity.encode(formatted)
}

utils.deserializeIdentity =
utils.unserializeIdentity = function (encoded) {
  const identity = schema.Identity.decode(encoded)
  utils.cleanupDecodedProtobuf(identity)
  identity[SIG] = identity[SIG].toString('base64')
  identity[TYPE] = constants.TYPES.IDENTITY
  if (identity[PERMALINK]) identity[PERMALINK] = identity[PERMALINK].toString('hex')
  if (identity[PREVLINK]) identity[PREVLINK] = identity[PREVLINK].toString('hex')

  identity.pubkeys = identity.pubkeys.map(utils.deserializePubKey)
  return identity
}

utils.toCompactPubKey = function (key) {
  const compact = {
    purpose: schema.KeyPurpose[key.purpose],
    type: schema.KeyType[key.type],
    pub: new Buffer(key.pub, key.type === 'dsa' ? 'base64' : 'hex')
  }

  if ('curve' in key) {
    compact.curve = key.curve && schema.ECurve[key.curve]
  }

  if ('networkName' in key) {
    compact.network = key.networkName === 'bitcoin' ? schema.Network.btcmain : schema.Network.btctest
  }

  if ('fingerprint' in key) {
    compact.fingerprint = key.type === 'bitcoin'
      ? bs58check.decode(key.fingerprint)
      : new Buffer(key.fingerprint, 'hex')
  }

  return compact
}

utils.serializePubKey = function (key) {
  return schema.PubKey.encode(utils.toCompactPubKey(key))
}

utils.deserializePubKey =
utils.unserializePubKey = function (serialized) {
  const compact = Buffer.isBuffer(serialized) ? schema.PubKey.decode(serialized) : serialized
  utils.cleanupDecodedProtobuf(compact)

  const key = {
    type: utils.keyByValue(schema.KeyType, compact.type),
    purpose: utils.keyByValue(schema.KeyPurpose, compact.purpose),
    pub: compact.type === schema.KeyType.dsa
      ? compact.pub.toString('base64')
      : compact.pub.toString('hex')
  }

  let networkName
  switch (compact.network) {
  case schema.Network.btcmain:
    key.networkName = 'bitcoin'
    break
  case schema.Network.btctest:
    key.networkName = 'testnet'
    break
  }

  if (compact.curve === schema.ECurve.none) {
    if (compact.type === 'ec') throw new Error('key is missing curve')

    delete compact.curve
  } else {
    key.curve = utils.keyByValue(schema.ECurve, compact.curve)
  }

  if ('fingerprint' in compact) {
    key.fingerprint = key.type === 'bitcoin'
      ? bs58check.encode(compact.fingerprint)
      : compact.fingerprint.toString('hex')
  } else {
    key.fingerprint = utils.importKey(key).fingerprint
  }

  return key
}

utils.cleanupDecodedProtobuf = function (decoded) {
  for (var p in decoded) {
    const val = decoded[p]
    if (val == null || (Buffer.isBuffer(val) && val.length === 0)) {
      delete decoded[p]
    }
  }

  return decoded
}

utils.keyByValue = function (obj, val) {
  for (var p in obj) {
    if (obj[p] === val) return p
  }
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
  return key.type === 'ec'
}

function isChainKey (key) {
  return key.type === 'bitcoin'
}

function isIdentityVersioningKey (key) {
  for (var p in constants.IDENTITY_VERSIONING_KEY) {
    const val = key[p] || (key.get && key.get(p))
    if (val !== constants.IDENTITY_VERSIONING_KEY[p]) return false
  }

  return true
  // const purpose = key.purpose || key.get('purpose')
  // return purpose === 'update'
}
