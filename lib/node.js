/** @module node */

const util = require('util')
const EventEmitter = require('events').EventEmitter
const path = require('path')
const reemit = require('re-emitter')
const map = require('map-stream')
const mutexify = require('mutexify')
// const trackchain = require('chain-tracker')
const async = require('async')
const debug = require('debug')('tradle:node')
const protocol = require('@tradle/protocol')
const changesFeed = require('@tradle/changes-feed')
const collect = require('stream-collector')
const deepEqual = require('deep-equal')
// const subdown = require('subleveldown')
const typeforce = require('@tradle/typeforce')
const createActions = require('./actions')
const symbols = require('./symbols')
const errors = require('./errors')
const statuses = require('./status')
const DEFAULT_OPTS = require('./defaults')
const SealStatus = statuses.seal
const createValidator = require('./validator')
const forget = require('./forget')
const constants = require('./constants')
const {
  MESSAGE_TYPE,
  TYPES,
  TYPE,
  SIG,
  SEQ,
  PERMALINK,
  LINK,
  AUTHOR,
  PREVLINK,
  PREVHEADER,
  VERSION,
} = constants

const utils = require('./utils.js')
const createDB = require('./dbs/index.js')
const createSealWatcher = require('./sealwatch.js')
const createSealer = require('./sealer.js')
const createSender = require('./sender.js')
const types = require('./types.js')
// const MAX_CONFIRMATIONS = 10
const noop = function () {}
const asyncNoop = function (cb) {
  process.nextTick(() => cb())
}

/**
 * @typedef {Object} node
 */

const tradleOpts = typeforce.object({
  dir: typeforce.String,
  network: typeforce.maybe(types.blockchainAdapter),
  getBlockchainAdapter: typeforce.maybe(typeforce.Function),
  identity: types.identity,
  keeper: types.keeper,
  keys: typeforce.Array,
  leveldown: types.leveldown,
  syncInterval: typeforce.maybe(typeforce.Number),
  confirmedAfter: typeforce.maybe(typeforce.Number),
  name: typeforce.maybe(typeforce.String),
  lockTimeout: typeforce.maybe(typeforce.Number),
  autoStart: typeforce.maybe(typeforce.Boolean)
  // merkle: typeforce.maybe(typeforce.object({
  //   leaf: typeforce.Function,
  //   parent: typeforce.Function
  // }))
})

const setIdentityOpts = typeforce.object({
  keys: typeforce.Array,
  identity: types.identity,
  link: typeforce.maybe(typeforce.String)
})

const updateIdentityOpts = typeforce.object({
  keys: typeforce.Array,
  identity: types.identity
})

const saveObjectWrapper = typeforce.object({
  object: types.signedObject,
  author: typeforce.maybe(typeforce.String)
})

const sendOpts = typeforce.object({
  to: types.identifier,
  object: typeforce.maybe(types.signedObject),
  link: typeforce.maybe(typeforce.String),
  other: typeforce.maybe(typeforce.Object),
  seal: typeforce.maybe(typeforce.Boolean),
  time: typeforce.maybe(typeforce.Number),
})

const sealOpts = typeforce.object({
  object: types.signedObject,
  basePubKey: typeforce.maybe(types.chainPubKey),
  network: typeforce.maybe(types.blockchainAdapter),
  amount: typeforce.maybe(typeforce.Number)
})

const watchNextVersionOpts = typeforce.object({
  chain: types.blockchainIdentifier,
  link: typeforce.maybe(typeforce.String),
  object: typeforce.maybe(typeforce.Object),
  headerHash: typeforce.maybe(typeforce.String),
  basePubKey: types.chainPubKey
})

const watchSealOpts = typeforce.object({
  chain: types.blockchainIdentifier,
  basePubKey: types.chainPubKey,
  link: typeforce.maybe(typeforce.String),
  object: typeforce.maybe(typeforce.Object),
  headerHash: typeforce.maybe(typeforce.String),
  txId: typeforce.maybe(typeforce.String)
})

const _watchOpts = typeforce.object({
  chain: types.blockchainIdentifier,
  link: typeforce.String,
  headerHash: typeforce.String,
  basePubKey: types.chainPubKey,
  watchType: typeforce.String,
  address: typeforce.maybe(typeforce.String),
  txId: typeforce.maybe(typeforce.String),
})

const abortMessagesMessages = typeforce.arrayOf(
  typeforce.object({
    link: typeforce.String,
    to: typeforce.String
  })
)

const abortUnsentOpts = typeforce.object({
  to: typeforce.String
})

/**
 * main API to tradle engine
 *
 * @constructor
 * @alias module:node
 * @param {Object} opts
 * @param {string} opts.dir               directory in which to store data
 * @param {Object} opts.blockchain        common-blockchain client instance
 * @param {Object} opts.getBlockchainAdapter
 * @param {Object} opts.identity          this node's identity
 * @param {Object} opts.keeper            object storage (see tradle/keeper)
 * @param {Array}  opts.keys              keys controlled by this identity
 * @param {Object} opts.leveldown         leveldown backend to use with internal databases
 * @param {Object} [opts.transactor]      [see transactor]{@link types#transactor}
 * @param {Number} [opts.syncInterval]    how often to sync with the blockchain
 * @param {Number} [opts.confirmedAfter]  how many confirmations till a transaction is deemed confirmed
 * @param {string} [opts.name]            this node's name (for a more readable log)
 * @property {AddressBook} addressBook
 * @property {sealsDB}     seals
 * @property {objectsDB}   objects
 * @property {identity}    identity
 * @property {Array}       keys
 * @property {sender}      sender
 * @property {sealer}      sealer
 */
function Tradle (opts) {
  const self = this
  if (!(this instanceof Tradle)) return new Tradle (opts)

  tradleOpts.asserts(opts)

  if (!(this.network || this.getBlockchainAdapter)) {
    throw new Error('expected either "network" or "getBlockchainAdapter"')
  }

  utils.bindFunctions(this)
  utils.extend(this, DEFAULT_OPTS, opts)

  this.opts = opts
  this._levelOpts = { db: this.leveldown }

  const logDB = this._logDB = this._createDB('log.db')
  const changes = this.changes = changesFeed(logDB)

  this.setIdentity(opts)
  this.actions = createActions({ changes, node: this })

  if (!this.name) this.name = this.permalink

  // init dbs
  this.dbs = {
    objects: this._createDB('objects.db'),
    seals: this._createDB('seals.db'),
    addressBook: this._createDB('addressBook.db'),
    watches: this._createDB('watches.db')
  }

  this.objects = createDB.objects({
    name: this.name,
    changes: changes,
    // db: subdown(ldb, 'o'),
    db: this.dbs.objects,
    keeper: this.keeper,
    identityInfo: this.identityInfo
  })

  this.seals = createDB.seals({
    changes: changes,
    // db: subdown(ldb, 's'),
    db: this.dbs.seals,
    keeper: this.keeper,
    confirmedAfter: this.confirmedAfter
  })

  this.watches = createDB.watches({
    changes: changes,
    db: this.dbs.watches,
    confirmedAfter: this.confirmedAfter
    // db: subdown(ldb, 'w')
  })

  // this.txs = createTxsDB({
  //   changes: changes,
  //   db: subdown(ldb, 't'),
  //   keeper: keeper
  // })

  this.addressBook = createDB.addressBook({
    changes: changes,
    keeper: this.keeper,
    db: this.dbs.addressBook,
    identityInfo: this.identityInfo
    // db: subdown(ldb, 'a')
  })

  this.sealwatch = createSealWatcher(this)
  reemit(this.sealwatch, this, ['seal'])

  // init various queues
  if (this.transactor) {
    this.sealer = createSealer(this)
    reemit(this.sealer, this, ['sealed'])
  }

  this.sender = createSender({
    name: this.name,
    objects: this.objects,
    send: function () {
      return self._send.apply(self, arguments)
    },
    actions: this.actions,
    addressBook: this.addressBook
  })

  reemit(this.sender, this, ['sent'])

  // this.setIdentity(this.identity)

  // misc

  this.validator = createValidator(this)
  this._saving = {}

  ;[
    { event: 'sent', db: this.objects },
    { event: 'sendaborted', db: this.objects },
    { event: 'message', db: this.objects },
    { event: 'readseal', db: this.seals },
    { event: 'wroteseal', db: this.seals },
    { event: 'readseal:confirmed', db: this.seals }
  ].forEach(conf => {
    conf.db.on(conf.event, state => {
      if (this._destroyed) return

      let { event } = conf
      let { link, prevLink } = state

      // maybe should emit both 'readseal' and 'newversion'
      if (event.indexOf('readseal') === 0 && !link) {
        event = event.replace('readseal', 'newversion')
        link = prevLink
      }

      this.keeper.get(link, (err, body) => {
        if (this._destroyed) return
        if (err) {
          this._debug(`missing object ${state.link}`)
          return this.emit('error', err)
        }

        state.object = body
        this.emit(event, state)
      })
    })
  })

  this._locks = {}
  this._init()
  if (this.autoStart) {
    this._onready(() => {
      this._exec('start')
    })
  }

  // utils.lockify(this, ['createObject', 'addContact'])
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)

/**
 * Initialize the node
 * @private
 */
Tradle.prototype._init = function _init () {
  // add ourselves to our own addressBook
  this.addressBook.byLink(this.link, err => {
    if (this._destroyed) return
    if (!err) {
      this._ready = true
      return this.emit('ready')
    }

    this.addContact(this.identity, err => {
      if (this._destroyed) return
      if (err) return this.emit('error', err)

      this._ready = true
      this.emit('ready')
    })
  })

  const emitters = [
    this.keeper, this.addressBook, this.objects, this.seals, this.watches,
    this.sealwatch, this.sealer, this.sender
  ]

  emitters.forEach(emitter => {
    if (emitter && emitter.on) {
      emitter.on('error', err => {
        if (this._destroyed) {
          return this._debug(`ignoring error emitted after node was destroyed: ${err.stack}`)
        }

        this.emit('error', err)
      })
    }
  })
}

/**
 * Overwritten by constructor opt getBlockchainAdapter
 * @param  {{ blockchain, networkName }} opts [description]
 */
Tradle.prototype.getBlockchainAdapter = function (opts) {
  if (this.network) {
    const { network } = this
    const { blockchain, networkName } = opts
    if (blockchain === network.blockchain && networkName === network.name) {
      return this.network
    }

    this._debug('missing blockchain adapter', { blockchain, networkName })
  }
}

/**
 * Log with a prefix
 * @private
 */
Tradle.prototype._debug = function () {
  utils.subdebug(debug, this.name || this.shortlink, arguments)
}

Tradle.prototype._createDB = function (name) {
  const dir = name[0] === '/' ? name : path.join(this.dir, name)
  return utils.levelup(dir, this._levelOpts)
}

Tradle.prototype.customIndexes = function (opts) {
  return createDB.simpleCustom({
    changes: this.changes,
    keeper: this.keeper,
    db: this._createDB(opts.db),
    preprocess: opts.preprocess,
    props: opts.props,
    getProps: opts.getProps
  })
}

/**
 * Check if our identity has a blockchain seal
 * @memberOf class:node
 * @param  {Function} cb
 */
Tradle.prototype.identitySealStatus = function (cb) {
  this.objectSealStatus(this.identityInfo, cb)
}

/**
 * Check if an object has a blockchain seal
 * @param  {Object}   opts [object/identifier]{@link types#someObjectInfo}
 * @param  {Function} cb
 */
Tradle.prototype.objectSealStatus = function (opts, cb) {
  const self = this
  types.someObjectInfo.assert(opts)

  const links = utils.getLinks(opts)
  const status = { permalink: false, prevLink: false, link: false, watches: {} }
  const props = ['permalink', 'prevLink', 'link'].filter(prop => links[prop])
  const checkSeals = props.map(prop => {
    return function (done) {
      self.seals.findOne('link', links[prop], function (err, seal) {
        if (!err) status[prop] = seal
        done()
      })
    }
  })

  const checkWatches = ['permalink', 'prevLink', 'link'].map(prop => {
    return function (done) {
      if (!links[prop]) return done()
      self.watches.findOne('link', links[prop], function (err, watch) {
        if (!err) status.watches[prop] = watch
        done()
      })
    }
  })

  async.parallel(checkSeals.concat(checkWatches), err => {
    if (err) return cb(err)

    cb(null, status)
  })
}

/**
 * Overwrite this node's identity. If you want to version the identity, use updateIdentity
 * @param {Object}   opts
 * @param {Array}    opts.keys      keys controlled by this identity
 * @param {Object}   opts.identity  [see identity]{@link types#identity}
 * @param {Object}   [opts.link]    this identity's link
 * @param {Function} cb
 */
Tradle.prototype.setIdentity = function (opts, cb) {
  const self = this

  setIdentityOpts.assert(opts)

  cb = utils.asyncify(cb)
//   if (!this.addressBook) return this._setIdentity(opts, cb)

//   // add own identity to addressBook
//   this.addContact(opts.identity, err => {
//     if (err) return cb(err)

//     this._setIdentity(opts, cb)
//   })
// }

// Tradle.prototype._setIdentity = function (opts, cb) {
  // const self = this

  this.keys = opts.keys.map(k => utils.importKey(k))
  this.identity = opts.identity
  this.pubKeys = this.identity.pubkeys.map(key => {
    if (key.type === 'ec') {
      return utils.toECKeyObj(key)
    }

    return key
  })

  this.chainPubKey = this.network && utils.chainPubKey(this.identity, this.network)
  this.sigKey = utils.sigKey(this.keys)
  this.sigPubKey = utils.toECKeyObj(this.sigKey.toJSON())
  this.identityVersioningKey = utils.identityVersioningKey(this.keys)
  this.identityVersioningPubKey = utils.identityVersioningPubKey(this.identity)
  this.link = opts.link || utils.hexLink(this.identity)
  this.permalink = this.identity[PERMALINK] || this.link
  this.shortlink = utils.shortlink(this.permalink)
  this._authorOpts = {
    permalink: this.permalink,
    sigPubKey: this.sigPubKey,
    sign: function (data, cb) {
      self.sigKey.sign(data, cb)
    }
  }

  this._authorIdentityOpts = {
    permalink: this.permalink,
    sigPubKey: this.identityVersioningPubKey,
    sign: function (data, cb) {
      self.identityVersioningKey.sign(data, cb)
    }
  }

  this._recipientOpts = {
    pubKey: this.sigPubKey,
    permalink: this.permalink
  }

  this.identityInfo = utils.objectInfo({
    // would be nice to store/cache this
    object: this.identity
  })

  if (this.addressBook) this.addContact(this.identity, cb)
  else cb()
}

/**
 * Update this node's identity. Unlike setIdentity, this performs versioning
 * against the current identity
 * @param {Object}   opts
 * @param {Array}    opts.keys      keys controlled by this identity
 * @param {Object}   opts.identity  [see identity]{@link types#identity}
 * @param {Function} cb
 */
Tradle.prototype.updateIdentity = function (opts, cb) {
  const self = this

  updateIdentityOpts.assert(opts)

  // utils.versionIdentity({
  //   keys: this.keys,
  //   identity: opts.identity,
  //   prev: this.identity
  // }, function (err, nextVersion) {
  //   if (err) return cb(err)

  //   self.setIdentity({
  //     keys: opts.keys,
  //     identity: nextVersion
  //   }, cb)
  // })

  let { identity, keys } = opts
  identity = utils.extend(
    protocol.nextVersion(identity),
    { [VERSION]: (this.identity[VERSION] || 0) + 1 }
  )

  identity = utils.omit(identity, SIG)
  this.sign({
    object: identity,
    author: this._authorIdentityOpts
  }, function (err, result) {
    if (err) return cb(err)

    const { object } = result
    const link = protocol.linkString(object)
    self.keeper.put(link, object, err => {
      if (err) return cb(err)

      self.setIdentity({
        identity: object,
        keys,
        link
      }, cb)
    })
  })
}

/**
 * Sign an object
 * @param  {Object}   opts
 * @param  {Object}   opts.object   object to be signed
 * @param  {Function} cb
 */
Tradle.prototype.sign = function sign (opts, cb) {
  let { object, author=this._authorOpts } = opts
  object = utils.omit(object, SIG)
  object[AUTHOR] = this.permalink
  object = protocol.object({ object })
  protocol.sign({ object, author }, cb)
}

/**
 * Add an identity to this node's addressBook
 * @param {Object}  identity          [identity object]{@link types#identity}
 * @param {Boolean} [overwrite=false] overwite existing mappings if such exist
 * @param {Function} cb
 */
Tradle.prototype.addContactIdentity =
Tradle.prototype.addContact = function addContact (identity, overwrite, cb) {
  const self = this

  types.identity.assert(identity)
  if (typeof overwrite === 'function') {
    cb = overwrite
    overwrite = false
  }

  cb = cb || noop

  // if (deepEqual(identity, this.identity)) return cb()

  let objInfo = utils.addLinks({ object: identity })
  let pubkeys = identity.pubkeys.filter(key => !key.importedFrom)
  const indexes = pubkeys.map(key => {
    return { pubKey: key.pub }
  })
  .concat(pubkeys.map(key => {
    return { fingerprint: key.fingerprint }
  }))

  let havePrevious
  let haveCurrent
  let haveCollision
  async.each(indexes, function (indexVal, done) {
    self.addressBook.lookupIdentity(indexVal, function (err, match) {
      if (err || !match) return done()

      if (identity[PREVLINK] === match.link) {
        havePrevious = true
      } else {
        if (deepEqual(match.object, identity)) {
          haveCurrent = true
        } else {
          haveCollision = true
        }
      }

      done()
    })
  }, err => {
    if (err) return cb(err)
    if (haveCollision && !overwrite) return cb(new Error('collision'))
    if (haveCurrent) return cb()

    // store contact
    self.keeper.put(objInfo.link, identity, err => {
      if (err) return cb(err)

      const tasks = havePrevious
        ? [saveObject, createAction]
        // if we don't have a previous version of the identity
        // we can't validate the authorship, so save to addressBook first
        : [createAction, saveObject]

      async.series(tasks, err => {
        if (err) return self.keeper.del(objInfo.link, cb)

        cb()
      })
    })
  })

  function createAction (done) {
    self.actions.addContact(identity, objInfo.link, done)
  }

  function saveObject (done) {
    self.saveObject({
      object: identity,
      author: objInfo.permalink,
      // if we don't have the previous version, we can't validate
      skipValidation: !havePrevious
    }, done)
  }
}

/**
 * Save an object. Triggers Action: createObject
 * (currently not underscore-prefixed, but this method may disappear from the public API)
 *
 * @private
 * @param {Object} wrapper
 * @param {Object} wrapper.object   signed object
 * @param {string} wrapper.author   object author
 */
Tradle.prototype.saveObject = function saveObject (wrapper, cb) {
  const self = this

  saveObjectWrapper.assert(wrapper)

  utils.addLinks(wrapper)
  if (wrapper.permalink !== this.permalink) {
    // allow saving our own identity
    if (!this._ready) {
      return this.once('ready', () => this.saveObject(wrapper, cb))
    }
  }

  const object = wrapper.object
  const link = wrapper.link

  if (this._saving[link]) {
    return process.nextTick(() => cb()) //new errors.AlreadySaving(wrapper))
  }

  this._saving[link] = true

  this._debug(`${symbols.save} 1. check existence of [${object[TYPE]}] ${link}`)

  // check if we already have it
  this.objects.exists(link, function (exists) {
    if (exists) return finish(new errors.ObjectExists({ link }))
    // if (exists) return finish()

    async.series([
      validate,
      augment,
      createAction
    ], finish)
  })

  function validate (done) {
    if (wrapper.skipValidation) return done()

    self.validator.validate(wrapper, done)
  }

  function finish (err) {
    delete self._saving[link]
    self._debug(`${symbols.save} queued ${link}`, err || '')
    if (err) {
      cb(err)
    } else {
      cb(null, utils.pick(wrapper, 'object', 'author', 'recipient', 'link', 'permalink'))
    }
  }

  function checkPrev (done) {
    if (!object[PREVLINK]) return done()

    self.keeper.get(object[PREVLINK], function (err, prev) {
      if (err) return done(err)

      try {
        protocol.validateVersioning({
          object, prev, orig: object[PERMALINK]
        })
      } catch (err) {
        return done(err)
      }

      // if (prev[PERMALINK] && prev[PERMALINK] !== object[PERMALINK]) {
      //   return done(new errors.InvalidVersion({
      //     error: `prev version has a different ${PERMALINK}`
      //   }))
      // }

      done()
    })
  }

  function augment (done) {
    async.parallel([
      save,
      checkSealed,
      // checkPartial
    ], done)
  }

  function save (done) {
    self._debug(`${symbols.save} 2a. store ${link}`)
    self.keeper.put(link, object, done)
  }

  function checkSealed (done) {
    self._debug(`${symbols.save} 2a. load seal status for ${link}`)
    self.seals.findOne('link', link, function (err, seal) {
      if (err) return done()

      wrapper.sealstatus = SealStatus.sealed
      wrapper.txId = seal.txId
      wrapper.confirmations = seal.confirmations
      wrapper.basePubKey = seal.basePubKey
      done()
    })
  }

  function createAction (done) {
    self._debug(`${symbols.save} 3. create action "createObject" ${link}`)
    wrapper.author = wrapper.author.permalink || wrapper.author
    self.actions.createObject(wrapper, done)
  }
}

/**
 * Signs and saves an object
 * @param  {Object}   opts
 * @param  {Object}   opts.object  [unsigned object]{@link types#rawObject}
 * @param  {Function} cb   [description]
 */
Tradle.prototype.createObject = function createObject (opts, cb) {
  const self = this
  this.sign(opts, function (err, result) {
    if (err) return cb(err)

    opts.author = self.permalink
    opts.object = result.object
    opts.skipValidation = true
    self.saveObject(opts, cb)
  })
}

/**
 * Sign an object and send it
 * @param  {Object}   opts see sign and send methods
 * @param  {Function} cb
 */
Tradle.prototype.signAndSend = function (opts, cb) {
  const self = this
  this._lock(opts.to, unlock => {
    this.sign(opts, (err, result) => {
      if (err) {
        unlock()
        return cb(err)
      }

      // make sure to do this on the same lock
      opts.object = result.object
      opts.author = self.permalink
      opts.time = result.object._time
      self._queueSend(opts, function () {
        unlock()
        cb.apply(self, arguments)
      })
    })
  })
}

/**
 * Send an object to another party
 * @param  {Object}   opts
 * @param  {Object}   opts.to         an identifier of another party
 * @param  {Object}   [opts.object]   the object to send
 * @param  {string}   [opts.link]     a link to the object to send
 * @param  {Object}   [opts.other]    custom properties to include in the message
 * @param  {Boolean}  [opts.seal]     if true, send the seal if it exists
 * @param  {Function} cb   [description]
 */
Tradle.prototype.send = function send (opts, cb) {
  const self = this

  sendOpts.assert(opts)

  this._lock(opts.to, function (unlock) {
    self._queueSend(opts, function () {
      unlock()
      cb.apply(self, arguments)
    })
  })
}

Tradle.prototype._queueSend = function _queueSend (opts, cb) {
  const self = this
  let recipientPermalink = opts.to.permalink
  if (!recipientPermalink) {
    return cb(new Error('expected recipient permalink'))
  }

  let { object, author, time=Date.now() } = opts
  let oLink = opts.link
  if (!(object || oLink)) return cb(new Error('expected "object" or "link"'))

  oLink = oLink || utils.hexLink(object)
  let wrapper
  let step = 0

  this._onready(function () {
    // auto-sequence
    async.auto({
      getBody: getBody,
      lookupRecipient: lookupRecipient,
      getAuthor: ['getBody', getAuthor],
      maybeGetSeal: maybeGetSeal,
      maybeSaveObject: ['getBody', maybeSaveObject],
      getNextID: ['lookupRecipient', getNextID],
      createMessage: ['maybeSaveObject', 'getNextID', 'maybeGetSeal', createMessage],
      saveMessage: ['createMessage', saveMessage]
    }, function (err, results) {
      if (err) return cb(err)

      cb(null, {
        message: wrapper,
        object: {
          author: results.getAuthor.author,
          link: oLink,
          permalink: object[PERMALINK] || oLink,
          object: object
        }
      })
    })
  })

  function getAuthor (results, done) {
    if (author) return done(null, { author })

    self.objects.get({ link: oLink, body: false }, function (err, result) {
      if (!err) return done(null, result)
      if (!err.notFound) return done(err)

      utils.lookupAuthor(self, { object: results.getBody }, function (err, result) {
        if (err) return done(err)

        done(null, { author: result.link })
      })
    })
  }

  function getBody (done) {
    self._debug(`${symbols.send} ${++step}. get body`)
    if (object) return done(null, object)

    self.keeper.get(oLink, done)
  }

  function lookupRecipient (done) {
    self._debug(`${symbols.send} ${++step}. lookup recipient`)
    self.addressBook.lookupIdentity(opts.to, done)
  }

  function maybeGetSeal (done) {
    if (!opts.seal) return done()

    self.seals.findOne('link', oLink, function (err, seal) {
      if (!err && seal.txId) {
        // formatted per tradle.Seal model
        done(null, {
          blockchain: seal.blockchain,
          network: seal.networkName,
          basePubKey: seal.basePubKey.pub,
          link: seal.link,
          headerHash: seal.headerHash,
        })
      } else {
        done()
      }
    })
  }

  function maybeSaveObject (results, done) {
    self._debug(`${symbols.send} ${++step}. maybe create object`)
    // already saved, we just looked it up by opts.link
    object = results.getBody
    if (!opts.object) return done()

    const author = self.permalink
    self.saveObject({ object, author, skipValidation: true }, function (err) {
      if (err && err.type === errors.ObjectExists.type) err = null

      done(err)
    })
  }

  // get next `seq` and link to prev message
  function getNextID (results, done) {
    self._debug(`${++step}. get next message id`)
    const identityInfo = results.lookupRecipient
    utils.addLinks(identityInfo)
    if (!recipientPermalink) recipientPermalink = identityInfo.permalink
    self.objects.nextMessageMetadata({ with: recipientPermalink }, done)
  }

  function createMessage (results, done) {
    const meta = results.getNextID
    self._debug(`${symbols.send} ${++step}. create message`)
    // const author = self._authorOpts
    const base = protocol.object({
      object: {
        [TYPE]: MESSAGE_TYPE,
        object,
        _recipient: recipientPermalink,
        _time: time
      }
    })

    const msg = utils.extend({}, opts.other || {}, meta, base)
    const seal = results.maybeGetSeal
    if (seal) msg.seal = seal

    self.sign({ object: msg }, done)
  }

    // don't need the below, as messages are sequenced per recipient
    //
    // function checkExists (result, done) {
    //   // messages can't have duplicates
    //   self._debug(`${symbols.send} 5. check if duplicate`)
    //   const link = protocol.linkString(result.object)
    //   self.objects.exists(link, function (exists) {
    //     if (exists) return done(new errors.MessageExists({ link }))

    //     done(null, result)
    //   })
    // },

  function saveMessage (results, done) {
    const msg = results.createMessage
    self._debug(`${symbols.send} ${++step}. save object`)
    wrapper = {
      object: msg.object,
      author: self.permalink,
      recipient: recipientPermalink,
      skipValidation: true
    }

    self.saveObject(wrapper, done)
  }
}

/**
 * Get 1:1 a conversation history stream. Delegate
 * @param  {Object} opts see [objects.conversation]{@link objects#conversation}
 */
Tradle.prototype.conversation = function (opts) {
  return this.objects.conversation(opts)
}

/**
 * Archive messages with a particular party
 * @param  {string}   permalink other party's permalink
 * @param  {Function} cb        [description]
 */
Tradle.prototype.forget = function (permalink, cb) {
  const node = this
  this._debug('forgetting correspondence with ' + permalink)
  forget({ node, permalink }, function (err, objects) {
    if (err) return cb(err)

    node._debug(`forgot ${objects.length} messages`)
    cb(null, objects)
  })
}

/**
 * Proxy a method call to submodules implementing a particular interface
 * @private
 * @param  {string} method
 */
Tradle.prototype._exec = function _exec (method) {
  this._debug(method)
  if (this.sealer) this.sealer[method]()
  this.sealwatch[method]()
  this.sender[method]()
}

/**
 * Pause all activity: sending, sealing, syncing
 * @param  {Object} [opts]
 * @param  {Number} [opts.timeout] auto-unpause after a timeout
 */
Tradle.prototype.pause = function (opts) {
  if (this._paused) return

  opts = opts || {}
  if (!this._ready) return this.once('ready', () => this.pause(opts))

  this._paused = true
  this._exec('pause')
  if (opts.timeout) {
    utils.timeout(this.resume, opts.timeout, true)
  }
}

/**
 * Resume activities: sending, sealing, syncing
 */
Tradle.prototype.resume = function () {
  if (!this._paused) return

  if (!this._ready) return this.once('ready', this.resume)

  this._paused = false
  this._exec('resume')
}

/**
 * Process an incoming message
 * @param  {Buffer|Object}   msg  serialized/unserialized message
 * @param  {Object}   from   [node identifier]{@link types#identifier}
 * @param  {Function} cb
 */
Tradle.prototype.receive = function receive (msg, from, cb) {
  const self = this

  types.identifier.assert(from)
  cb = utils.asyncify(cb)

  if (msg[PERMALINK] || msg[PREVLINK]) {
    return cb(new Error('messages cannot be versioned'))
  }

  if (!this._ready) {
    return this.once('ready', () => this.receive(msg, from, cb))
  }

  this._lock(from, function (unlock) {
    self._receive(msg, from, function () {
      unlock()
      cb.apply(self, arguments)
    })
  })
}

Tradle.prototype._receive = function _receive (msg, from, cb) {
  const self = this
  const object = msg.object
  const seal = msg.seal
  const addressBook = this.addressBook
  const objects = this.objects
  let sender, msgID, mLink, oLink, sLink

  const wrappers = {
    object: { object },
    message: {
      object: msg,
      // needs to be verified
      author: from
    }
  };

  // for objects: msg & msg.object
  //   save objects to keeper
  //   check if we know the object's author
  //   check each object follows the rules
  //   log both objects (object, then message)

  const validator = this.validator
  this._debug('receive 1. validate message & embedded object')
  async.each(wrappers, function validate (wrapper, done) {
    // why series?
    async.series([
      taskCB => {
        // msgs must be unique
        const unique = wrapper === wrappers.message
        validator.validate(wrapper, { unique }, taskCB)
      }
    ], done)
  }, function (err) {
    if (err) return cb(err)

    self._debug('receive 2. store')
    wrappers.message.objectinfo = {
      author: wrappers.object.author.permalink,
      link: wrappers.object.link,
      permalink: wrappers.object.permalink,
    }

    wrappers.message.partialinfo = wrappers.object.partialinfo
    utils.saveToKeeper(self.keeper, utils.values(wrappers), function (err) {
      if (err) return cb(err)

      async.each(wrappers, function log (wrapper, done) {
        const slim = utils.clone(wrapper)
        slim.author = slim.author.permalink
        slim.recipient = wrapper.recipient ? wrapper.recipient.permalink : self.permalink
        slim.received = true
        self.actions.createObject(slim, done)
      }, err => {
        if (err) return cb(err)
        if (seal) {
          self.watchSeal({
            chain: {
              blockchain: seal.blockchain,
              networkName: seal.network || seal.networkName
            },
            headerHash: seal.headerHash,
            basePubKey: utils.getSealPubKey(seal)
          })
        }

        cb(null, wrappers)
      })
    })
  })
}

/**
 * Create a blockchain seal for an object
 * @param  {Object}   opts
 * @param  {Object}   [opts.object]                      the object to send
 * @param  {string}   [opts.link]                        a link to the object to send
 * @param  {Object}   [opts.basePubKey=this.chainPubKey] [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {Number}   [opts.amount]                      amount to spend on the transaction
 * @param  {Function} cb   [description]
 */
Tradle.prototype.seal = function seal (opts, cb) {
  const self = this

  sealOpts.assert(opts)

  let { object, network } = opts
  if (!network) network = this.network
  if (!network) return cb(new Error('expected "network"'))

  const link = utils.hexLink(object)
  const headerHash = protocol.headerHash(object)
  const basePubKey = opts.basePubKey || this.chainPubKey
  const sealPubKey = protocol.sealPubKey({ object, basePubKey })
  const sealAddress = network.pubKeyToAddress(sealPubKey.pub)
  // const uid = utils.sealUID({ link, sealPubKey })
  this.seals.findOne('sealAddress', sealAddress, function (err, seal) {
    if (err && !err.notFound) return cb(err)
    if (seal) return cb(new errors.SealExists(seal))

    // make sure we have this object
    // if not, require createObject to be called first
    self.keeper.get(link, function (err, object) {
      if (err) return cb(err)

      let sealPrevPubKey, sealPrevAddress, prevHeaderHash
      if (object[PREVLINK]) {
        prevHeaderHash = object[PREVHEADER]
        sealPrevPubKey = protocol.sealPrevPubKey({ basePubKey, prevHeaderHash })
        sealPrevAddress = network.pubKeyToAddress(sealPrevPubKey.pub)
      }

      // const sealPrevAddress = sealPrevPubKey &&
      //   utils.sealPrevAddress(basePubKey, link, self.networkName)

      const blockchain = network.blockchain
      const networkName = network.name
      const sealProps = {
        link,
        prevLink: object[PREVLINK],
        headerHash,
        prevHeaderHash,
        basePubKey,
        sealAddress,
        sealPrevAddress,
        sealPubKey,
        sealPrevPubKey,
        amount: opts.amount,
        blockchain,
        networkName
      }

      self.actions.writeSeal(sealProps, err => {
        if (err) return cb(err)

        cb(null, sealProps)
      })

      self.watchSeal({
        chain: {
          blockchain,
          networkName
        },
        object,
        basePubKey
      })
    })
  })
}

/**
 * Monitor the blockchain for a seal announcing a new version of the object with link `link`
 * @param  {Object}   opts
 * @param  {string}   opts.headerHash current header hash
 * @param  {Object}   opts.basePubKey [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {Function} cb
 */
Tradle.prototype.watchNextVersion = function (opts, cb) {
  watchNextVersionOpts.assert(opts)

  let { chain, link, object, headerHash, basePubKey } = opts
  if (!headerHash) headerHash = protocol.headerHash(object)
  if (!link) link = utils.hexLink(object)

  const address = utils.sealPrevAddress({
    network: this.getBlockchainAdapter(chain),
    basePubKey,
    headerHash
  })

  this._watch({
    // the next version's previous is the current version
    // the tx for next version will have a predictable seal based on the current version's link
    chain,
    link,
    address,
    basePubKey,
    headerHash: protocol.iterateHeaderHash(headerHash),
    watchType: constants.watchType.nextVersion
  }, cb)
}

/**
 * Monitor the blockchain for a seal for the object with link `link`
 *
 * @param  {Object}   opts
 * @param  {Object}   opts.headerHash string
 * @param  {Object}   opts.basePubKey [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {Function} cb
 */
Tradle.prototype.watchSeal = function (opts, cb) {
  watchSealOpts.assert(opts)

  let { chain, link, object, headerHash, basePubKey, txId } = opts
  if (!headerHash) headerHash = protocol.headerHash(object)
  if (!link) link = utils.hexLink(object)

  const address = utils.sealAddress({
    network: this.getBlockchainAdapter(chain),
    basePubKey,
    headerHash
  })

  const wOpts = {
    chain,
    link,
    address,
    basePubKey,
    headerHash,
    watchType: constants.watchType.thisVersion
  }

  if (txId) wOpts.txId = txId

  this._watch(wOpts, cb)
}

/**
 * watch an address for a seal for an object's current or next version
 * @private
 * @param  {Object}   opts
 * @param  {string}   opts.blockchain blockchain to monitor
 * @param  {string}   opts.networkName blockchain network to monitor
 * @param  {string}   opts.headerHash headerHash to monitor
 * @param  {Object}   opts.basePubKey [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {string}   opts.watchType  [watch type]{@link constants#watchType}
 * @param  {string}   [opts.address]  address at which to expect seal
 * @param  {Function} cb
 */
Tradle.prototype._watch = function (opts, cb) {
  const self = this

  _watchOpts.assert(opts, true)

  async.parallel([
    function checkExistingWatch (done) {
      self.watches.get(opts, function (err, watch) {
        done(watch && new errors.WatchExists(watch))
      })
    },
    function checkExistingSeal (done) {
      const type = opts.watchType
      const prop = type === constants.watchType.thisVersion ? 'sealAddress' : 'sealPrevAddress'
      self.seals.find(prop, opts[prop], function (err, seals) {
        if (!err) {
          const sealed = utils.find(seals, seal => seal.status === SealStatus.sealed)
          if (sealed) {
            return done(new errors.SealExists({ uid: sealed.uid }))
          }
        }

        done()

        // if (seal && seal.status) {
        //   return done(new errors.SealExists({ uid }))
        // }

        // done()
      })
    }
  ], function (err) {
    if (err) return cb(err)

    opts = inlineChain(opts)
    self.actions.createWatch(opts, cb)
  })
}

/**
 * Override this method to provide delivery of messages
 * @param  {Buffer}   msg
 * @param  {Object}   [recipientInfo]{@link types.identityInfo}
 * @param  {Function} cb
 */
Tradle.prototype._send = function _send (msg, recipientInfo, cb) {
  cb(new Error('implement this method yourself'))
}

/**
 * Execute a function after initialization is complete
 * @private
 * @param  {Function} fn
 */
Tradle.prototype._onready = function (fn) {
  if (this._ready) return fn()

  this.once('ready', fn)
}

/**
 * Terminate all internal activity and close database handles
 * @param  {Function} cb
 */
Tradle.prototype.destroy = function destroy (cb) {
  cb = cb || noop
  if (this._destroyed) return cb(new Error('already destroying or destroyed'))
  if (!this._ready) return this.once('ready', () => this.destroy())

  this.emit('destroying')
  this._destroyed = true
  this._debug('self-destructing')
  this._exec('stop')
  const dbs = Object.keys(this.dbs).map(k => this.dbs[k])
    .concat(this._logDB)
    .concat(this.keeper)

  ;[
    this.network && this.network.api,
    this.transactor
  ].forEach(closeable => {
    if (closeable && closeable.close) {
      closeable.close()
    }
  })

  async.each(dbs, function iterator (db, done) {
    db.close(done)
  }, err => {
    if (err) return cb(err)

    cb()
    this.emit('destroy')
  })
}

/**
 * Trigger a sync with the blockchain
 * @param  {Function} cb
 */
Tradle.prototype.sync = function (cb) {
  this.sealwatch.sync(cb)
}

Tradle.prototype._lock = function (id, cb) {
  const self = this
  if (typeof id === 'object') {
    try {
      id = getLockId(id)
    } catch (err) {
      return cb(err)
    }
  }

  typeforce.String.assert(id)
  if (!this._locks[id]) this._locks[id] = mutexify()

  this._locks[id](function (release) {
    // unlock after timeout
    const timeout = setTimeout(function () {
      self._debug('unlock timed out, releasing')
      release()
    }, self.lockTimeout)

    cb(function unlock () {
      clearTimeout(timeout)
      release.apply(this, arguments)
    })
  })
}

Tradle.prototype.abortMessages = function (messages, cb) {
  const self = this

  abortMessagesMessages.assert(messages)

  const recipients = messages.map(({ to }) => to)
  const links = messages.map(({ link }) => link)
  recipients.forEach(to => {
    this.sender.pause(to)
    this.sender.stop(to)
  })

  async.forEach(links, this.actions.abortMessage, function (err) {
    if (err) return cb(err)

    recipients.forEach(to => {
      self.sender.resume(to)
    })

    cb()
  })
}

Tradle.prototype.abortUnsent = function (opts, cb) {
  const self = this

  abortUnsentOpts.assert(opts)

  const { to } = opts
  this.sender.pause(to)
  this.sender.stop(to)

  const unsent = this.objects.unsentTo(to, {
    live: false,
    keys: false,
    body: false
  })

  collect(unsent, function (err, results) {
    if (err) return cb(err)

    const links = results.map(({ link }) => link)
    let togo = links.slice()
    self.on('sendaborted', onAborted)

    async.forEach(links, self.actions.abortMessage, function (err) {
      if (err) return cb(err)
    })

    function onAborted (message) {
      togo = togo.filter(link => link !== message.link)
      if (!togo.length) {
        cb(null, links)
        self.sender.resume(to)
      }
    }
  })
}

function getLockId (identifier) {
  const id = identifier.permalink || identifier.link || identifier.fingerprint
  if (id) return id

  if (identifier.pubKey) {
    return identifier.pubKey.pub.toString('hex')
  }

  throw new Error('invalid lock id')
}

function inlineChain (opts) {
  opts = utils.clone(opts)
  utils.extend(opts, opts.chain)
  delete opts.chain
  return opts
}
