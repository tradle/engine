'use strict'

/**
 * utils
 * @module utils
 * @augments tradle/protocol/lib/utils
 */

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
const deepEqual = require('deep-equal')
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
// const nkeyBitcoin = require('nkey-bitcoin')
const nkeyImpls = loadNKeyImplementations()
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
const errors = require('./errors')
const hydra = hydration()
const {
  TYPE,
  TYPES,
  PERMALINK,
  PREV_TO_SENDER,
  LINK,
  PREVLINK,
  SIG,
  SEQ
} = constants

const {
  IDENTITY,
  MESSAGE,
  PARTIAL
} = TYPES

/**
 * @constant
 * @type {String}
 * @default
 */
const DEFAULT_CURVE = 'p256'
/**
 * @constant
 * @type {String}
 * @default
 */
const DEFAULT_NETWORK = 'testnet'

const utils = exports

;['omit', 'pick', 'asyncify', 'ecPubKeysAreEqual', 'assert', 'sign', 'parseSig'].forEach(method => {
  utils[method] = putils[method]
})

exports.stringify = stringify
exports.deepEqual = deepEqual

exports.find = function (arr /* filters */) {
  let match
  const filters = Array.prototype.slice.call(arguments, 1)
  arr.some(function (item) {
    if (filters.every(f => f(item))) {
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

exports.noop = function noop () {}

exports.mergeStreams = function mergeStreams (streams, compare) {
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

exports.notFoundErr = function notFoundErr () {
  return new levelErrors.NotFoundError()
}

// exports.watchUID = function watchUID (opts) {
//   typeforce({
//     address: typeforce.String,
//     link: typeforce.String,
//     watchType: typeforce.String
//   }, opts)

//   return `watch:${opts.watchType}:${opts.address}:${opts.link}`
// }

// exports.addBody = function addBody (keeper, wrapper, link, cb) {
//   keeper.get(link, function (err, body) {
//     if (err) return cb(err)

//     wrapper.object = body
//     cb()
//   })
// }

// exports.getSealAddresses = function (seal) {
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

exports.uid = function (opts) {
  const links = utils.getLinks(opts)
  return links.permalink + ':' + links.link

  // const object = opts.object
  // const link = utils.hexLink(opts.link || object)
  // const permalink = opts.permalink || object[PERMALINK] || link
  // return link + ':' + permalink
}

// exports.prevUID = function (opts) {
//   const links = utils.getLinks(opts)
//   if (!links.prevLink) throw new Error('missing prevLink')

//   return links.permalink + ':' + links.prevLink
// }

// exports.parseUID = function (uid) {
//   const parts = uid.split(':')
//   return {
//     [PERMALINK]: parts[0],
//     [LINK]: parts[1]
//   }
// }

// exports.getMsgID = function getMsgID (opts) {
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

// exports.augment = function augment (wrapper, keeper, cb) {
//   keeper.get(utils.hex(wrapper.link), function (err, obj) {
//     if (err) return cb(err)

//     wrapper.object = obj
//     cb(null, wrapper)
//   })
// }

exports.sigKey = keys => utils.find(keys, isSigningKey, isPrivateKey)

// exports.sigKeys = keys => keys.filter(isSigningKey)

exports.sigPubKey = function (identity) {
  const key = utils.find(identity.pubkeys, isSigningKey)
  return key && utils.toECKeyObj(key)
}

exports.identityVersioningKey = keys => utils.find(keys, isIdentityVersioningKey, isPrivateKey)

exports.identityVersioningPubKey = function identityVersioningPubKey (identity) {
  const key = utils.find(identity.pubkeys, isIdentityVersioningKey)
  return key && utils.toECKeyObj(key)
}

// exports.sigPubKeys = identity => identity.pubkeys.filter(isSigningKey)

exports.chainKey = keys => utils.find(keys, isChainKey, isPrivateKey)

// exports.chainKeys = keys => keys.filter(isChainKey)

exports.chainPubKey = function chainPubKey (identity) {
  const key = utils.find(identity.pubkeys, isChainKey)
  return key && utils.toECKeyObj(key)
}

// exports.chainPubKeys = identity => identity.pubkeys.filter(isChainKey)

exports.toECKeyObj = function toECKeyObj (key) {
  return {
    curve: key.type === 'bitcoin' ? 'secp256k1' : key.curve,
    pub: new Buffer(key.pub, 'hex')
  }
}

exports.bindFunctions = function bindFunctions (obj) {
  for (let p in obj) {
    const val = obj[p]
    if (typeof val === 'function') {
      obj[p] = obj[p].bind(obj)
    }
  }

  return obj
}

exports.findPubKey = function (identity, props) {
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

exports.hasPubKey = function (identity, props) {
  return !!utils.findPubKey(identity, props)
}

/**
 * shallow extend an object
 * @static
 * @param {Object} obj
 * @returns {Object} passed in object
 */
exports.extend = extend

/**
 * shallow clone an object
 * @static
 * @param {Object} obj
 * @returns {Object} a new object with copied-over props
 */
exports.clone = clone

/**
 * calculate an object's link
 * @static
 * @param  {Object} object
 * @return {String}
 */
exports.hexLink = function (object) {
  return utils.hex(protocol.link(object))
}

exports.linkToBuf = function (link) {
  return Buffer.isBuffer(link) ? link : new Buffer(link, 'hex')
}

// utils.toBuffer = function (obj, enc) {
//   return Buffer.isBuffer(obj) ? obj :
//     typeof obj === 'string' ? new Buffer(obj, enc) :
//       new Buffer(JSON.stringify(obj), enc)
// }

exports.filterStream = function (test) {
  return through.obj(function (data, enc, cb) {
    cb(null, test(data) ? data : null)
  })
}

// exports.flatten = function (arr) {
//   // flatten array of arrays
//   return arr.reduce((flat, nextArr) => {
//     return flat.concat(nextArr)
//   }, [])
// }

// exports.stringToObject = str => rebuf(JSON.parse(str))

exports.opToBatch = function (op) {
  return op.batch ? op.batch : [op.value]
}

/**
 * sha256
 * @static
 * @param  {Buffer|String} data
 * @return {Buffer}
 */
exports.sha256 = function (data) {
  return crypto.createHash('sha256').update(data).digest()
}

exports.pubKeyString = function (key) {
  if (typeof key === 'string') return key

  typeforce(typeforce.Buffer, key.pub)

  return key.pub.toString('hex')
}

exports.pubKeyToAddress = function pubKeyToAddress (pubKey, networkName) {
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

exports.privToWIF = function (priv, networkName, compressed) {
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

exports.objectInfo = function objectInfo (wrapper) {
  const info = utils.getLinks(wrapper)
  info.object = wrapper.object
  return info
}

exports.getLinks = function getLinks (wrapper) {
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

exports.addLinks = function addLinks (wrapper) {
  return utils.extend(wrapper, utils.getLinks(wrapper))
}

exports.maybeAddPrev = function maybeAddPrev (node, wrapper, cb) {
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

// exports.xor = function (a, b) {
//   if (typeof a !== 'number') a = a ? 1 : 0
//   if (typeof b !== 'number') b = b ? 1 : 0

//   return a ^ b
// }

// exports.addAuthors = function addAuthors (wrappers, addressBook, cb) {
//   async.each(wrappers, function iterator (wrapper, done) {
//     utils.addAuthor(wrapper, addressBook, done)
//   }, cb)
// }

exports.addRecipient = function addRecipient (node, wrapper, cb) {
  if (wrapper.object[TYPE] !== MESSAGE) return cb()

  utils.lookupRecipient(node, wrapper, function (err, objectInfo) {
    if (err) return cb(err)

    wrapper.recipient = objectInfo
    cb()
  })
}

exports.lookupRecipient = function (node, wrapper, cb) {
  if (wrapper.object[TYPE] !== MESSAGE) throw new Error('expected a message object')

  node.addressBook.byPubKey(wrapper.object.recipientPubKey, cb)
}

exports.addAuthor = function addAuthor (node, wrapper, cb) {
  utils.lookupAuthor(node, wrapper, function (err, objectInfo) {
    if (err) return cb(err)

    wrapper.author = objectInfo
    cb()
  })
}

exports.lookupAuthor = function lookupAuthor (node, wrapper, cb) {
  const author = wrapper.author
  if (author && typeof author === 'object') {
    if (author.object) {
      return cb(null, author)
    }

    if (author.link) {
      return node.addressBook.byLink(author.link, cb)
    }
  }

  getPubKey(function (err, pubKey) {
    if (err) return cb(err)

    node.addressBook.byPubKey(utils.pubKeyString(pubKey), cb)
  })

  function getPubKey (done) {
    if (wrapper.verify) {
      utils.extractSigPubKey(wrapper.object, done)
    } else {
      done(null, utils.claimedSigPubKey(wrapper.object))
    }
  }
}

exports.shortlink = function (link) {
  return link.slice(0, 6)
}

exports.subdebugger = function (debug, name) {
  // accept `node` or string
  name = name && name.name || name
  typeforce(typeforce.String, name)
  return function () {
    utils.subdebug(debug, name, arguments)
  }
}

exports.subdebug = function (debug, name, args) {
  args = [].slice.call(args)
  args.unshift(name)
  return debug.apply(null, args)
}

exports.loadBG = function loadBG (node, wrapper, cb) {
  utils.addLinks(wrapper)

  const tasks = [
    taskCB => utils.addAuthor(node, wrapper, taskCB),
    taskCB => utils.addRecipient(node, wrapper, taskCB),
    taskCB => utils.maybeAddPrev(node, wrapper, taskCB),
    taskCB => utils.addPartialInfo(node, wrapper, taskCB)
  ]

  async.parallel(tasks, cb)
}

exports.addPartialInfo = function addPartialInfo (node, wrapper, cb) {
  utils.getPartialInfo(node, wrapper, function (err, partialinfo) {
    if (err) return cb(err)

    wrapper.partialinfo = partialinfo
    cb()
  })
}

exports.getPartialInfo =  function getPartialInfo (node, wrapper, cb) {
  const { object, skipValidation } = wrapper
  if (object[TYPE] !== PARTIAL) return cb()

  const Partial = require('./partial')
  if (!Partial.verify(object)) {
    return cb(new errors.InvalidPartial())
  }

  const sig = object.sig
  async.waterfall([
    verify,
    getInfo
  ], cb)

  function verify (done) {
    if (!skipValidation) {
      return Partial.extractSigPubKey(object, done)
    }

    let pubKey
    try {
      pubKey = utils.claimedSigPubKey(sig)
    } catch (err) {
      return done(err)
    }

    done(null, pubKey)
  }

  function getInfo (pubKey, done) {
    if (!pubKey) {
      return done(new errors.InvalidSignature({
        sig: sig
      }))
    }

    node.addressBook.byPubKey(pubKey, function (err, identityInfo) {
      // original author is unknown
      if (err) return done(err)

      const author = identityInfo.permalink
      if (!utils.findPubKey(identityInfo.object, pubKey)) {
        return done(new errors.Author({
          author: author,
          sig: sig
        }))
      }

      const stub = { [SIG]: sig}
      const link = utils.hexLink(stub)
      done(null, {
        link: link,
        author: author
      })
    })
  }
}

// exports.identityIndices = function identityIndices (identityInfo) {
//   typeforce(types.identityInfo, identityInfo)
//   const keys = identityInfo.object.pubkeys
//   return keys.map(key => key.pub)
//     .concat(keys.map(key => key.fingerprint))
//     .concat(identityInfo.link)
// }

exports.claimedSigPubKey = function (object) {
  // const sig = object[TYPE] === PARTIAL
  //   // get signature of original object
  //   ? utils.find(object.properties, p => p === SIG).value
  //   : object[SIG] || object

  const sig = object[SIG] || object
  return protocol.utils.parseSig(sig).pubKey
}

exports.extractSigPubKey = function (object, cb) {
  const parsed = protocol.parseObject({ object })
  const keyJSON = utils.extend({ type: 'ec' }, parsed.pubKey)
  const key = utils.importKey(keyJSON)
  if (cb) {
    key.verify(parsed.merkleRoot, parsed.sig, function (err, verified) {
      if (!err && !verified) {
        err = new errors.InvalidSignature({ sig: parsed.sig })
      }

      cb(err, verified && parsed.pubKey)
    })

    return
  }

  if (key.verifySync(parsed.merkleRoot, parsed.sig)) {
    return parsed.pubKey
  }
}

exports.sign = function (data, key) {
  key = utils.extend({ type: key.type || 'ec' }, key)
  return utils.importKey(key).signSync(data)
}

// exports.verifyAuthor = function verifyAuthor (wrapper) {
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

// exports.execAsync = function (fn, cb) {
//   try {
//     var result = fn()
//   } catch (err) {
//     return cb(err)
//   }

//   cb(null, result)
// }

exports.saveToKeeper = function saveToKeeper (keeper, wrappers, cb) {
  const batch = wrappers.map(w => {
    return {
      type: 'put',
      key: w.link || w.object[LINK],
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

exports.sealAddress = function sealAddress (basePubKey, link, networkName) {
  const pubKey = protocol.sealPubKey({
    link: utils.linkToBuf(link),
    basePubKey: basePubKey
  })

  return utils.pubKeyToAddress(pubKey, networkName)
}

exports.sealPrevAddress = function sealPrevAddress (basePubKey, link, networkName) {
  const pubKey = protocol.sealPrevPubKey({
    prevLink: utils.linkToBuf(link),
    basePubKey: basePubKey
  })

  return utils.pubKeyToAddress(pubKey, networkName)
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

// exports.alphabetical = function alphabetical (a, b) {
//   return a < b ? -1 :
//     a > b ? 1 : 0
// }

exports.parseTx = function parseTx (txInfo, networkName) {
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

exports.parseTxSender = function parseTxSender (tx, networkName) {
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

exports.getOutputAddresses = function getOutputAddresses (tx, networkName) {
  return tx.outs.map(function (output) {
    return utils.getAddressFromOutput(output, networkName)
  })
  .filter(truthy)
}

exports.getAddressFromOutput = function getAddressFromOutput (output, networkName) {
  if (bitcoin.scripts.classifyOutput(output.script) === 'pubkeyhash') {
    return bitcoin.Address
      .fromOutputScript(output.script, bitcoin.networks[networkName])
      .toString()
  }
}

/**
 * monkey-patch `obj` to ensure async `methods` of `obj` never overlap
 * @static
 * @returns obj
 */
exports.lockify = function lockify (obj, methods) {
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

/**
 * monkey-patch `obj` to log invocations of `method`
 * @param {Object}  obj
 * @param {string}  method
 * @param {boolean} [logArgs=false]
 * @returns obj
 */
exports.logify = function logify (obj, method, logArgs) {
  const orig = obj[method]
  obj[method] = function logifyProxy () {
    const result = orig.apply(obj, arguments)
    if (logArgs) console.log(method, 'args:', arguments)
    console.log(method, 'result:', result)
    return result
  }
}

/**
 * print the current stack
 * @static
 */
exports.printStack = function () {
  try {
    throw new Error('')
  } catch (err) {
    console.error(err.stack)
  }
}

/**
 * get the descriptors for the default set of keys
 * @static
 * @param {string} [networkName=DEFAULT_NETWORK]
 * @returns {Array}
 */
exports.defaultKeySet = function defaultKeySet (networkName) {
  networkName = networkName || DEFAULT_NETWORK
  return [
    { type: 'bitcoin', purpose: 'payment', networkName: networkName },
    { type: 'bitcoin', purpose: 'messaging', networkName: networkName },
    { type: 'ec', purpose: 'sign', curve: 'p256' },
    { type: 'ec', purpose: 'update', curve: 'p256' },
    { type: 'ec', purpose: 'tls',  curve: 'curve25519' }
    // { type: 'dsa', purpose: 'sign' }
  ]
}

/**
 * Generate a default set of keys
 * @static
 * @param {string} [networkName=DEFAULT_NETWORK]
 * @returns {Array}
 */
exports.generateDefaultKeySet = function generateDefaultKeySet (networkName) {
  const descriptors = utils.defaultKeySet(networkName)
  return utils.generateKeySet(descriptors)
}

/**
 * Generate a set of keys
 * @static
 * @param {Array} spec for keys to generate
 * @returns {Array}
 */
exports.generateKeySet = function generateKeySet (keys) {
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

/**
 * Generate a key
 * @static
 * @param {Object}   spec   spec for key
 * @param {Function} [cb]
 */
exports.genKey = function (spec, cb) {
  const impl = utils.getKeyImplementation(spec)
  return cb ? impl.gen(spec, cb) : impl.genSync(spec)
}

/**
 * Get a key implementation by key a spec
 * @static
 * @param  {Object} spec
 * @return {nkeyModule}
 */
exports.getKeyImplementation = function (spec) {
  const impl = nkeyImpls[spec.curve] || nkeyImpls[spec.type]
  if (!impl) {
    throw new Error('unsupported key type: ' + JSON.stringify(spec))
  }

  return impl
}

/**
 * import a key json to an nkey object
 * @static
 * @param  {Object} key
 * @return {nkey}
 */
exports.importKey = function (key) {
  if (typeof key.toJSON === 'function') return key

  return utils.getKeyImplementation(key).fromJSON(key)
}

/**
 * Generate a new set of keys and corresponding identity object
 * @static
 * @param  {Object}   opts
 * @param  {string}   [opts.networkName]
 * @param  {Array}    [opts.keys]  spec for which keys to generate
 * @param  {Function} cb
 */
exports.newIdentity = function newIdentity (opts, cb) {
  typeforce({
    networkName: typeforce.maybe(typeforce.String),
    keys: typeforce.maybe(typeforce.Array)
  }, opts)

  let keys
  if (opts.keys) {
    keys = utils.generateKeySet(opts.keys)
  } else {
    keys = utils.generateDefaultKeySet(opts.networkName)
  }

  utils.newIdentityForKeys(keys, cb)
}

exports.newIdentityForKeys = function newIdentityForKeys (keys, cb) {
  let identity = {
    [TYPE]: IDENTITY,
    pubkeys: keys.map(k => k.toJSON())
  }

  const sigPubKeyJSON = utils.find(identity.pubkeys, isIdentityVersioningKey)
  const sigKey = utils.find(keys, k => k.pubKeyString === sigPubKeyJSON.pub)
  protocol.sign({
    author: {
      sigPubKey: utils.toECKeyObj(sigPubKeyJSON),
      sign: sigKey.sign.bind(sigKey)
    },
    object: identity
  }, function (err, result) {
    if (err) return cb(err)

    identity = result.object // signed
    cb(null, {
      identity,
      keys,
      link: protocol.linkString(identity)
    })
  })
}

exports.signee = function signee (opts) {
  typeforce({
    permalink: typeforce.String,
    link: typeforce.String
  }, opts)

  return opts.permalink + ':' + opts.link
}

exports.firstInStream = function firstInStream (stream, cb) {
  cb = once(cb)
  combine.obj(
    stream,
    head(1)
  )
  .on('data', data => cb(null, data))
  .on('error', cb)
  .on('end', () => cb(utils.notFoundErr()))
}

/**
 * promisify a node and its components, based on manifest.js
 * @static
 * @param  {node} node
 * @param  {Promise} [promiseImpl=global.Promise] promise implementation
 * @return {node}
 */
exports.promisifyNode = function promisifyNode (node, promiseImpl) {
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

/**
 * promisify a method based on manifest.js
 * @static
 * @param  {Object}   obj
 * @param  {string}   method
 * @param  {Promise}  [promiseImpl=global.Promise] promise implementation
 * @return {node}
 */
exports.promisifyMethod = function (obj, method, promiseImpl) {
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

exports.timeout = function timeout (fn, millis, unref) {
  const t = setTimeout(fn, millis)
  if (unref && t.unref) t.unref()
  return t
}

exports.getMessageCustomProps = function (msg) {
  return utils.omit(msg, [
    SEQ,
    TYPE,
    'recipientPubKey',
    'object',
    SIG,
    PREV_TO_SENDER,
    'seal'
  ])
}

/**
 * serialize a message object to a Buffer
 * @static
 * @param  {Object} msg
 * @return {Buffer}
 */
exports.serializeMessage = function (msg) {
  var copy = {}
  var other = utils.getMessageCustomProps(msg)
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
    case SEQ:
      copy[p] = val
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
    }
  }

  if (Object.keys(other).length) {
    copy.other = new Buffer(JSON.stringify(other))
  }

  return schema.Message.encode(copy)
}

/**
 * unserialize a message Buffer to a message object
 * @static
 * @param  {Buffer} msg
 * @return {Object}
 */
exports.unserializeMessage = function (msg) {
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
      maybeParseEmbeddedMessage(msg[p])
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

  msg[TYPE] = MESSAGE
  if (msg.other) {
    utils.extend(msg, JSON.parse(msg.other))
    delete msg.other
  }

  return msg
}

var SERIALIZABLE_IDENTITY_PROPS = [
  TYPE, SIG, PERMALINK, PREVLINK, 'pubkeys'
]

/**
 * compact serialization of an identity object
 * @static
 * @param  {identity} identity
 * @return {Buffer}
 */
exports.serializeIdentity = function (identity) {
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

/**
 * unserialize a serialized identity
 * @static
 * @param  {Buffer} encoded
 * @return {identity}
 */
exports.deserializeIdentity =
exports.unserializeIdentity = function (encoded) {
  const identity = schema.Identity.decode(encoded)
  utils.cleanupDecodedProtobuf(identity)
  identity[SIG] = identity[SIG].toString('base64')
  identity[TYPE] = IDENTITY
  if (identity[PERMALINK]) identity[PERMALINK] = identity[PERMALINK].toString('hex')
  if (identity[PREVLINK]) identity[PREVLINK] = identity[PREVLINK].toString('hex')

  identity.pubkeys = identity.pubkeys.map(utils.deserializePubKey)
  return identity
}

exports.toCompactPubKey = function (key) {
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

exports.serializePubKey = function (key) {
  return schema.PubKey.encode(utils.toCompactPubKey(key))
}

exports.deserializePubKey =
exports.unserializePubKey = function (serialized) {
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

exports.cleanupDecodedProtobuf = function (decoded) {
  for (var p in decoded) {
    const val = decoded[p]
    if (val == null || (Buffer.isBuffer(val) && val.length === 0)) {
      delete decoded[p]
    }
  }

  return decoded
}

exports.keyByValue = function (obj, val) {
  for (var p in obj) {
    if (obj[p] === val) return p
  }
}

exports.getSealPubKey = function (seal) {
  // check Network to get curve
  return {
    curve: 'secp256k1',
    pub: seal.basePubKey
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

function getKeyProp (key, prop) {
  if (prop === 'type') return key.type
  if (typeof key.get === 'function') return key.get(prop)

  return key[prop]
}

function isSigningKey (key) {
  if (key.type !== 'ec') return

  key = key.toJSON ? key.toJSON() : key
  return key.type === 'ec' && /^secp256k1|ed25519|p\d+$/.test(key.curve)
}

function isChainKey (key) {
  return getKeyProp(key, 'type') === 'bitcoin'
}

function isPrivateKey (key) {
  return !!key.priv || typeof key.sign === 'function' && key.isPrivateKey
}

function isIdentityVersioningKey (key) {
  for (var p in constants.IDENTITY_VERSIONING_KEY) {
    const val = getKeyProp(key, p)
    if (val !== constants.IDENTITY_VERSIONING_KEY[p]) return false
  }

  return true
  // const purpose = key.purpose || key.get('purpose')
  // return purpose === 'update'
}

function loadNKeyImplementations () {
  const impls = {}
  try {
    impls.ec = require('nkey-ecdsa')
  } catch (err) {}

  try {
    impls.curve25519 = require('nkey-curve25519')
  } catch (err) {}

  try {
    impls.bitcoin = require('nkey-bitcoin')
  } catch (err) {}

  return impls
}

function maybeParseEmbeddedMessage (obj) {
  if (obj[TYPE] !== MESSAGE) return

  obj.recipientPubKey.pub = new Buffer(obj.recipientPubKey.pub)
  maybeParseEmbeddedMessage(obj.object)
}
