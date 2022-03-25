/**
 * utils
 * @module utils
 * @augments tradle/protocol/lib/utils
 */
const extend = require('lodash/extend')
const clone = require('lodash/clone')
const cloneDeep = require('lodash/cloneDeep')
const groupBy = require('lodash/groupBy')
const chunk = require('lodash/chunk')
const partition = require('lodash/partition')
const once = require('once')
const Stream = require('readable-stream')
const Readable = Stream.Readable
const combine = require('stream-combiner2')
const stringify = require('json-stable-stringify')
const deepEqual = require('deep-equal')
const async = require('async')
const through = require('through2')
const levelup = require('levelup')
const levelErrors = require('level-errors')
const hydration = require('hydration')
const mutexify = require('mutexify')
const nkeyImpls = loadNKeyImplementations()
const protocol = require('@tradle/protocol')
const putils = require('@tradle/protocol/lib/utils')
const typeforce = require('@tradle/typeforce')
const constants = require('./constants')
const types = require('./types')
const head = require('./head')
const manifest = require('./manifest')
const errors = require('./errors')
const hydra = hydration()
const {
  TYPE,
  TYPES,
  PREV_TO_RECIPIENT,
  LINK,
  PREVLINK,
  SIG,
  SEQ,
  AUTHOR,
  RECIPIENT
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
const DEFAULT_NETWORK = {
  bitcoin: 'testnet',
  ethereum: 'ropsten'
}

const generateKeySetKeys = typeforce.arrayOf(
  typeforce.object({
    type: typeforce.String,
    purpose: typeforce.String
  })
)
const findPubKeyProps = typeforce.object({
  pub: types.bufferOrString
})
const newIdentityOpts = typeforce.object({
  networks: typeforce.maybe(typeforce.Object),
  keys: typeforce.maybe(typeforce.Array)
})
const signeeOpts = typeforce.object({
  permalink: typeforce.String,
  link: typeforce.String
})

const utils = exports

;['omit', 'pick', 'asyncify', 'ecPubKeysAreEqual', 'assert', 'sign', 'parseSig'].forEach(method => {
  utils[method] = putils[method]
})

exports.defineGetter = defineGetter
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

  function done () {
    if (--togo) return

    arr.sort(compare).forEach(out.push, out)
    out.push(null)
  }
}

exports.notFoundErr = function notFoundErr () {
  return new levelErrors.NotFoundError()
}

exports.uid = function (opts) {
  const links = utils.getLinks(opts)
  return links.permalink + ':' + links.link
}

exports.isSigningKey = function isSigningKey (key) {
  if (key.type !== 'ec') return

  key = key.toJSON ? key.toJSON() : key
  return key.type === 'ec' && /^secp256k1|ed25519|p\d+$/.test(key.curve)
}

exports.isChainKey = function isChainKey (key, chain) {
  const blockchain = getKeyProp(key, 'type')
  const networkName = getKeyProp(key, 'networkName')
  const purpose = getKeyProp(key, 'purpose')
  return blockchain === chain.blockchain &&
    networkName === chain.name &&
    purpose === 'messaging'
}

exports.isIdentityVersioningKey = function isIdentityVersioningKey (key) {
  for (var p in constants.IDENTITY_VERSIONING_KEY) {
    const val = getKeyProp(key, p)
    if (val !== constants.IDENTITY_VERSIONING_KEY[p]) return false
  }

  return true
}

exports.sigKey = keys => utils.find(keys, utils.isSigningKey, isPrivateKey)

exports.sigPubKey = function (identity) {
  const key = utils.find(identity.pubkeys, utils.isSigningKey)
  return key && utils.toECKeyObj(key)
}

exports.identityVersioningKey = keys => utils.find(keys, utils.isIdentityVersioningKey, isPrivateKey)

exports.identityVersioningPubKey = function identityVersioningPubKey (identity) {
  const key = utils.find(identity.pubkeys, utils.isIdentityVersioningKey)
  return key && utils.toECKeyObj(key)
}

exports.chainKey = function (keys, chain) {
  return utils.find(keys, key => utils.isChainKey(key, chain), isPrivateKey)
}

exports.chainPubKey = function chainPubKey (identity, chain) {
  const key = utils.find(identity.pubkeys, key => utils.isChainKey(key, chain))
  return key && utils.toECKeyObj(key)
}

exports.toECKeyObj = function toECKeyObj (key) {
  return {
    curve: getKeyCurve(key),
    pub: Buffer.from(key.pub, 'hex')
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
  types.identity.assert(identity)
  findPubKeyProps.assert(props)

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
exports.cloneDeep = cloneDeep

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
  return Buffer.isBuffer(link) ? link : Buffer.from(link, 'hex')
}
exports.filterStream = function (test) {
  return through.obj(function (data, enc, cb) {
    cb(null, test(data) ? data : null)
  })
}

exports.flatten = function (arr) {
  // flatten array of arrays
  return arr.reduce((flat, nextArr) => {
    return flat.concat(nextArr)
  }, [])
}

exports.opToBatch = function (op) {
  return op.batch ? op.batch : [op.value]
}

exports.pubKeyString = function (key) {
  if (typeof key === 'string') return key

  typeforce.Buffer.assert(key.pub)

  return key.pub.toString('hex')
}

exports.objectInfo = function objectInfo (wrapper) {
  const info = utils.getLinks(wrapper)
  info.object = wrapper.object
  return info
}

exports.getLinks = protocol.links
exports.addLinks = function addLinks (wrapper) {
  return utils.extend(wrapper, utils.getLinks(wrapper))
}

exports.maybeAddPrev = function maybeAddPrev (node, wrapper, cb) {
  if (wrapper.prev) return cb()

  const prevLink = wrapper.object[PREVLINK]
  if (!prevLink) return cb()

  node.objects.get({ link: prevLink }, function (err, prev) {
    wrapper.prev = prev
    cb()
  })
}

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

  node.addressBook.byPermalink(wrapper.object._recipient, cb)
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
  if (name.name) name = name.name

  typeforce.String.assert(name)
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

  const { sig } = object
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

      done(null, {
        link: object.root.hash,
        author: author
      })
    })
  }
}

exports.claimedSigPubKey = function (object) {
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

exports.sealAddress = function sealAddress ({ network, basePubKey, object, headerHash }) {
  if (!headerHash) headerHash = protocol.headerHash(object)
  const pubKey = protocol.sealPubKey({ headerHash, basePubKey })
  return network.pubKeyToAddress(pubKey.pub)
}

exports.sealPrevAddress = function sealPrevAddress ({ network, basePubKey, object, headerHash }) {
  if (!headerHash) headerHash = protocol.headerHash(object)
  const pubKey = protocol.sealPrevPubKey({ prevHeaderHash: headerHash, basePubKey })
  return network.pubKeyToAddress(pubKey.pub)
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
 * @param {Object}  chainName->[networkNames]
 * @returns {Array}
 */
exports.defaultKeySet = function defaultKeySet (networks) {
  const networkKeys = Object.keys(networks).map(chainName => {
    const networkNames = networks[chainName] || DEFAULT_NETWORK[chainName]
    const keyDefs = [].concat(networkNames).map(networkName => ([
      { type: chainName, purpose: 'payment', networkName  },
      { type: chainName, purpose: 'messaging', networkName },
    ]))

    return utils.flatten(keyDefs)
  })

  return [
    { type: 'ec', purpose: 'sign', curve: 'p256' },
    { type: 'ec', purpose: 'update', curve: 'p256' },
    { type: 'ec', purpose: 'tls', curve: 'curve25519' }
  ].concat(utils.flatten(networkKeys))
}

/**
 * Generate a default set of keys
 * @static
 * @param {string} [networkName=DEFAULT_NETWORK]
 * @returns {Array}
 */
exports.generateDefaultKeySet = function generateDefaultKeySet (networks) {
  const descriptors = utils.defaultKeySet(networks)
  return utils.generateKeySet(descriptors)
}

/**
 * Generate a set of keys
 * @static
 * @param {Array} spec for keys to generate
 * @returns {Array}
 */
exports.generateKeySet = function generateKeySet (keys) {
  generateKeySetKeys.assert(keys)

  return keys.map(k => {
    if ((k.type === 'bitcoin' || k.type === 'ethereum') && !k.networkName) {
      k = utils.clone(k)
      k.networkName = DEFAULT_NETWORK[k.type]
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
  newIdentityOpts.assert(opts)

  let keys
  if (opts.keys) {
    keys = utils.generateKeySet(opts.keys)
  } else {
    keys = utils.generateDefaultKeySet(opts.networks)
  }

  utils.newIdentityForKeys(keys, cb)
}

exports.newIdentityForKeys = function newIdentityForKeys (keys, cb) {
  let identity = protocol.object({
    object: {
      [TYPE]: IDENTITY,
      pubkeys: keys.map(k => k.toJSON())
    }
  })

  const sigPubKeyJSON = utils.find(identity.pubkeys, utils.isIdentityVersioningKey)
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
  signeeOpts.assert(opts)

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

        resolve(val)
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
    'object',
    SIG,
    PREV_TO_RECIPIENT,
    AUTHOR,
    RECIPIENT,
    'seal'
  ])
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

exports.xor = function xor (a, b) {
  return (a || b) && !(a && b)
}

exports.networkToIdentifier = network => ({
  blockchain: network.blockchain,
  networkName: network.name,
})

exports.chunk = chunk
exports.groupBy = groupBy
exports.partition = partition
exports.throttledQueue = (millis) => {
  const queue = []
  let timeout

  const pollQueue = () => {
    if (!queue.length) {
      timeout = undefined
      return
    }

    try {
      queue.shift()()
    } catch (err) {
      myDebug('throttled blockchain call failed', err.message)
    }

    timeout = utils.timeout(pollQueue, millis)
  }

  return fn => {
    queue.push(fn)
    if (typeof timeout !== 'undefined') return

    pollQueue()
    timeout = utils.timeout(pollQueue, millis)
  }
}

function getKeyProp (key, prop) {
  if (prop === 'type') return key.type
  if (typeof key.get === 'function') return key.get(prop)

  return key[prop]
}

function isPrivateKey (key) {
  return !!key.priv || (typeof key.sign === 'function' && key.isPrivateKey)
}

function loadNKeyImplementations () {
  const impls = {}
  defineGetter(impls, 'ec', () => require('nkey-ecdsa'))
  defineGetter(impls, 'curve25519', () => require('nkey-curve25519'))
  defineGetter(impls, 'bitcoin', () => require('nkey-bitcoin'))
  defineGetter(impls, 'ethereum', () => require('nkey-ethereum'))
  return impls
}

function getKeyCurve (key) {
  if (key.curve) return key.curve

  if (key.type === 'bitcoin' || key.type === 'ethereum') {
    return 'secp256k1'
  }
}

function defineGetter (obj, prop, get) {
  Object.defineProperty(obj, prop, { get })
}
