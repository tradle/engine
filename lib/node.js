'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const path = require('path')
const extend = require('xtend/mutable')
const clone = require('xtend')
const reemit = require('re-emitter')
const map = require('map-stream')
// const trackchain = require('chain-tracker')
const async = require('async')
const debug = require('debug')('tradle:node')
const protocol = require('@tradle/protocol')
const changesFeed = require('changes-feed')
const collect = require('stream-collector')
const deepEqual = require('deep-equal')
// const subdown = require('subleveldown')
const tradle = require('../')
const typeforce = require('./typeforce')
const createActions = require('./actions')
const constants = require('./constants')
const symbols = require('./symbols')
const errors = require('./errors')
const statuses = require('./status')
const DEFAULT_OPTS = require('./defaults')
const SealStatus = statuses.seal
const MESSAGE_TYPE = constants.MESSAGE_TYPE
const createValidator = require('./validator')
const TYPE = constants.TYPE
const SIG = constants.SIG
const SEQ = constants.SEQ
// const NONCE = constants.NONCE
// const SIGNEE = constants.SIGNEE
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const utils = tradle.utils
const createDB = tradle.dbs
const createSealWatcher = tradle.sealwatch
const createSealer = tradle.sealer
const createSender = tradle.sender
const topics = tradle.constants.topics
const createLiveQueue = tradle.queue
// const Status = tradle.constants.status
const types = tradle.types
// const MAX_CONFIRMATIONS = 10
const noop = () => {}

function Tradle (opts) {
  const self = this
  if (!(this instanceof Tradle)) return new Tradle (opts)

  typeforce({
    networkName: typeforce.String,
    dir: typeforce.String,
    blockchain: typeforce.Object,
    identity: types.identity,
    keeper: types.keeper,
    keys: typeforce.Array,
    leveldown: types.leveldown,
    transactor: typeforce.maybe(types.transactor),
    syncInterval: typeforce.maybe(typeforce.Number),
    confirmedAfter: typeforce.maybe(typeforce.Number),
    name: typeforce.maybe(typeforce.String),
    // merkle: typeforce.maybe(typeforce.compile({
    //   leaf: typeforce.Function,
    //   parent: typeforce.Function
    // }), opts.merkle)
  }, opts)

  extend(this, DEFAULT_OPTS, opts)
  utils.bindFunctions(this)

  this.opts = opts

  const dir = opts.dir
  this._levelOpts = { db: this.leveldown }

  const logDB = this._logDB = utils.levelup(path.join(dir, 'log.db'), this._levelOpts)
  const changes = this.changes = changesFeed(logDB)

  this.setIdentity(opts)
  this.actions = createActions({ changes, node: this })

  if (!this.name) this.name = this.permalink

  // init dbs
  // const ldb = this._dataDB = utils.levelup(path.join(dir, 'tradle.db'), this._levelOpts)
  this.dbs = {
    objects: utils.levelup(path.join(dir, 'objects.db'), this._levelOpts),
    seals: utils.levelup(path.join(dir, 'seals.db'), this._levelOpts),
    addressBook: utils.levelup(path.join(dir, 'addressBook.db'), this._levelOpts),
    watches: utils.levelup(path.join(dir, 'watches.db'), this._levelOpts)
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
    keeper: this.keeper
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
    { event: 'message', db: this.objects },
    { event: 'readseal', db: this.seals },
    { event: 'wroteseal', db: this.seals }
  ].forEach(conf => {
    let event = conf.event
    conf.db.on(event, state => {
      if (this._destroyed) return

      let link = state.link
      if (event === 'readseal' && !link) {
        event = 'newversion'
        link = state.prevLink
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

  this._init()
  this._onready(() => {
    this._exec('start')
  })
  // utils.lockify(this, ['createObject', 'addContact'])
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)
const proto = Tradle.prototype

/**
 * Initialize the node
 *
 * @private
 */
proto._init = function init () {
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
        if (!this._destroyed) this.emit('error', err)
        else this._debug(`ignoring error emitted after node was destroyed: ${err.stack}`)
      })
    }
  })
}

/**
 * Log with a prefix
 *
 * @private
 */
proto._debug = function () {
  utils.subdebug(debug, this.name || this.shortlink, arguments)
}

/**
 * Check if our identity has a blockchain seal
 *
 * @param  {Function} cb
 */
proto.identitySealStatus = function (cb) {
  this.objectSealStatus(this.identityInfo, cb)
}

/**
 * Check if an object has a blockchain seal
 *
 * @param  {Object}   opts [object/identifier]{@link types#someObjectInfo}
 * @param  {Function} cb
 */
proto.objectSealStatus = function (opts, cb) {
  const self = this
  typeforce(types.someObjectInfo, opts)

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
 *
 * @param {Object}   opts
 * @param {Array}    opts.keys      keys controlled by this identity
 * @param {Object}   opts.identity  [see identity]{@link types#identity}
 * @param {Object}   [opts.link]    this identity's link
 * @param {Function} cb
 */
proto.setIdentity = function (opts, cb) {
  const self = this

  typeforce({
    keys: typeforce.Array,
    identity: types.identity,
    link: typeforce.maybe(typeforce.String)
  }, opts)

  cb = utils.asyncify(cb)
//   if (!this.addressBook) return this._setIdentity(opts, cb)

//   // add own identity to addressBook
//   this.addContact(opts.identity, err => {
//     if (err) return cb(err)

//     this._setIdentity(opts, cb)
//   })
// }

// proto._setIdentity = function (opts, cb) {
  // const self = this

  this.keys = opts.keys.map(k => utils.importKey(k))
  this.identity = opts.identity
  this.pubKeys = this.identity.pubkeys.map(key => {
    if (key.type === 'ec') {
      return utils.toECKeyObj(key)
    } else {
      return key
    }
  })

  this.chainPubKey = utils.chainPubKey(this.identity)
  this.sigKey = utils.sigKey(this.keys)
  this.sigPubKey = utils.sigPubKey(this.identity)
  this.identityVersioningKey = utils.identityVersioningKey(this.keys)
  this.identityVersioningPubKey = utils.identityVersioningPubKey(this.identity)
  this.link = opts.link || utils.hexLink(this.identity)
  this.permalink = this.identity[PERMALINK] || this.link
  this.shortlink = utils.shortlink(this.permalink)
  this._authorOpts = {
    sigPubKey: this.sigPubKey,
    sign: function (data, cb) {
      self.sigKey.sign(data, cb)
    }
  }

  this._authorIdentityOpts = {
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
 *
 * @param {Object}   opts
 * @param {Array}    opts.keys      keys controlled by this identity
 * @param {Object}   opts.identity  [see identity]{@link types#identity}
 * @param {Function} cb
 */
proto.updateIdentity = function (opts, cb) {
  const self = this

  typeforce({
    keys: typeforce.Array,
    identity: types.identity
  }, opts)

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

  const author = this._authorIdentityOpts
  const object = opts.identity
  const link = deepEqual(object, this.identity) && this.link
  object[PREVLINK] = this.link
  object[PERMALINK] = this.permalink
  delete object[SIG]
  this.sign({ object, author }, function (err, result) {
    if (err) return cb(err)

    const object = result.object
    const link = protocol.linkString(object)
    self.keeper.put(link, object, err => {
      if (err) return cb(err)

      self.setIdentity({
        keys: opts.keys,
        identity: object,
        link: link
      }, cb)
    })
  })
}

/**
 * Sign an object
 *
 * @param  {Object}   opts
 * @param  {Object}   opts.object   object to be signed
 * @param  {Function} cb
 */
proto.sign = function sign (opts, cb) {
  const self = this
  const author = opts.author || this._authorOpts
  const object = utils.clone(opts.object)
  delete object[SIG]

  // const author = object[TYPE] === constants.TYPES.IDENTITY
  //   ? this._authorIdentityOpts
  //   : this._authorOpts

  protocol.sign({ object, author }, cb)
}

/**
 * Add an identity to this node's addressBook
 * @param {Object}  identity          [identity object]{@link types#identity}
 * @param {Function} cb
 */
proto.addContactIdentity =
proto.addContact = function addContact (identity, cb) {
  const self = this

  typeforce(types.identity, identity)
  cb = cb || noop

  // if (deepEqual(identity, this.identity)) return cb()

  let objInfo = utils.addLinks({ object: identity })
  const indexes = identity.pubkeys.map(key => {
    return { pubKey: key.pub }
  })
  .concat(identity.pubkeys.map(key => {
    return { fingerprint: key.fingerprint }
  }))

  let havePrevious
  let haveCurrent
  let haveCollision
  async.each(indexes, function (indexVal, done) {
    self.addressBook.lookupIdentity(indexVal, function (err, match) {
      if (!match) return done()

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
    if (haveCollision) return cb(new Error('collision'))
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
 *
 * @private  currently not underscore-prefixed, but this method may disappear from the public API
 * @param {Object} wrapper
 * @param {Object} wrapper.object   signed object
 * @param {String} wrapper.author   object author
 */
proto.saveObject = function saveObject (wrapper, cb) {
  const self = this

  typeforce({
    object: types.signedObject,
    author: typeforce.String
  }, wrapper)

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
    self._debug(`${symbols.save} queued`, err || '')
    if (err) {
      cb(err)
      // self.emit('save:error', link, err)
    } else {
      cb(null, wrapper)
      // self.emit('save:success', link)
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
      // addAuthor
    ], done)
  }

  function save (onsaved) {
    self._debug(`${symbols.save} 2a. store`)
    self.keeper.put(link, object, onsaved)
  }

  function checkSealed (onchecked) {
    self._debug(`${symbols.save} 2a. load seal status`)
    self.seals.findOne('link', link, function (err, seal) {
      if (err) return onchecked()

      wrapper.sealstatus = SealStatus.sealed
      wrapper.txId = seal.txId
      wrapper.confirmations = seal.confirmations
      wrapper.basePubKey = seal.basePubKey
      onchecked()
    })
  }

  function createAction (done) {
    self._debug(`${symbols.save} 3. create action "createObject"`)
    wrapper.author = wrapper.author.permalink || wrapper.author
    self.actions.createObject(wrapper, done)
  }
}

/**
 * Signs and saves an object
 *
 * @param  {Object}   opts
 * @param  {Object}   opts.object  [unsigned object]{@link types#rawObject}
 * @param  {Function} cb   [description]
 */
proto.createObject = function createObject (opts, cb) {
  const self = this
  typeforce({
    object: types.rawObject
  }, opts)

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
 *
 * @param  {Object}   opts see sign and send methods
 * @param  {Function} cb
 */
proto.signAndSend = function (opts, cb) {
  this.sign(opts, (err, result) => {
    if (err) return cb(err)

    opts.object = result.object
    this.send(opts, cb)
  })
}

/**
 * Send an object to another party
 *
 * @param  {Object}   opts
 * @param  {Object}   opts.to         an identifier of another party
 * @param  {Object}   [opts.object]   the object to send
 * @param  {String}   [opts.link]     a link to the object to send
 * @param  {Object}   [opts.other]    custom properties to include in the message
 * @param  {Boolean}  [opts.seal]     if true, send the seal if it exists
 * @param  {Function} cb   [description]
 */
proto.send = function send (opts, cb) {
  const self = this

  typeforce({
    to: types.identifier,
    object: typeforce.maybe(types.signedObject),
    link: typeforce.maybe(typeforce.String),
    other: typeforce.maybe(typeforce.Object),
    seal: typeforce.maybe(typeforce.Boolean)
  }, opts)

  let recipientPubKey = opts.to.pubKey
  let recipientPermalink = opts.to.permalink
  let object = opts.object
  let oLink = opts.link
  if (!(object || oLink)) throw new Error('expected "object" or "link"')

  oLink = oLink || utils.hexLink(object)
  let wrapper

  this._onready(function () {
    // auto-sequence
    async.auto({
      getBody: getBody,
      lookupRecipient: lookupRecipient,
      maybeGetSeal: maybeGetSeal,
      maybeCreateObject: ['getBody', maybeCreateObject],
      getNextID: ['lookupRecipient', getNextID],
      createMessage: ['maybeCreateObject', 'getNextID', 'maybeGetSeal', createMessage],
      saveObject: ['createMessage', saveObject]
    }, function (err) {
      if (err) return cb(err)

      cb(null, {
        message: wrapper,
        object: {
          link: oLink,
          permalink: object[PERMALINK] || oLink,
          object: object
        }
      })
    })
  })

  function getBody (done) {
    self._debug(`${symbols.send} 1. get body`)
    if (object) return done(null, object)

    self.keeper.get(oLink, done)
  }

  function lookupRecipient (done) {
    self._debug(`${symbols.send} 3. lookup recipient`)
    self.addressBook.lookupIdentity(opts.to, done)
  }

  function maybeGetSeal (done) {
    if (!opts.seal) return done()

    self.seals.findOne('link', oLink, function (err, seal) {
      if (!err && seal.txId) {
        done(null, {
          network: self.networkName,
          basePubKey: seal.basePubKey.pub,
          link: oLink
        })
      } else {
        done()
      }
    })
  }

  function maybeCreateObject (results, done) {
    self._debug(`${symbols.send} 2. maybe create object`)
    object = results.getBody
    const method = object[SIG] ? 'saveObject' : 'createObject'
    const author = self.permalink
    self[method]({ object, author, skipValidation: true }, function (err) {
      if (err && err.type === errors.ObjectExists.type) err = null

      done(err)
    })
  }

  // get next `seq` and link to prev message
  function getNextID (results, done) {
    const identityInfo = results.lookupRecipient
    utils.addLinks(identityInfo)
    if (!recipientPubKey) recipientPubKey = utils.sigPubKey(identityInfo.object)
    if (!recipientPermalink) recipientPermalink = identityInfo.permalink
    self.objects.nextMessageMetadata({ with: recipientPermalink }, done)
  }

  function createMessage (results, done) {
    const meta = results.getNextID
    self._debug(`${symbols.send} 4. create message`)
    // const author = self._authorOpts
    const required = { [TYPE]: MESSAGE_TYPE, object, recipientPubKey }
    const msg = utils.clone(opts.other || {}, meta, required)
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

  function saveObject (results, done) {
    const msg = results.createMessage
    self._debug(`${symbols.send} 5. save object`)
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
proto.conversation = function (opts) {
  return this.objects.conversation(opts)
}

/**
 * Archive messages with a particular party
 * @param  {String}   permalink other party's permalink
 * @param  {Function} cb        [description]
 */
proto.forget = function forget (permalink, cb) {
  const self = this

  this._debug('forgetting correspondence with ' + permalink)

  // let count = 0
  const stream = this.conversation({
    with: permalink,
    body: true
  })
  .pipe(map(function (data, done) {
    // count++
    self.actions.forgetObject(data.link, err => {
      if (err) return done(err)

      done(null, data)
    })
  }))

  collect(stream, function (err, objects) {
    if (err) return cb(err)

    self._debug(`forgot ${objects.length} messages`)
    cb(null, objects)
  })
}

/**
 * Proxy a method call to submodules implementing a particular interface
 *
 * @private
 * @param  {String} method
 */
proto._exec = function _exec (method) {
  if (this.sealer) this.sealer[method]()
  this.sealwatch[method]()
  this.sender[method]()
}

/**
 * Pause all activity: sending, sealing, syncing
 *
 * @param  {Object} [opts]
 * @param  {Number} [opts.timeout] auto-unpause after a timeout
 */
proto.pause = function (opts) {
  if (this._paused) return

  opts = opts || {}
  if (!this._ready) return this.once('ready', () => this.pause(opts.timeout))

  this._paused = true
  this._exec('pause')
  if (opts.timeout) {
    utils.timeout(this.resume, opts.timeout, true)
  }
}

/**
 * Resume activities: sending, sealing, syncing
 */
proto.resume = function () {
  if (!this._paused) return

  if (!this._ready) return this.once('ready', this.resume)

  this._paused = false
  this._exec('resume')
}

/**
 * Process an incoming message
 *
 * @param  {Buffer|Object}   msg  serialized/unserialized message
 * @param  {Object}   from   [node identifier]{@link types#identifier}
 * @param  {Function} cb
 */
proto.receive = function receive (msg, from, cb) {
  const self = this

  typeforce(types.identifier, from)
  cb = utils.asyncify(cb)

  try {
    if (Buffer.isBuffer(msg)) {
      msg = utils.unserializeMessage(msg)
    }
  } catch (err) {
    return cb(err)
  }

  if (msg[PERMALINK] || msg[PREVLINK]) {
    return cb(new Error('messages cannot be versioned'))
  }

  // if (!utils.hasPubKey(this.identity, msg.recipientPubKey)) {
  //   return cb(new Error('recipientPubKey in message is not in this node\'s identity'))
  // }

  if (!this._ready) {
    return this.once('ready', () => this.receive(msg, from, cb))
  }

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

    utils.saveToKeeper(self.keeper, utils.values(wrappers), function (err) {
      if (err) return cb(err)

      async.each(wrappers, function log (wrapper, done) {
        const slim = utils.clone(wrapper)
        slim.author = slim.author.permalink
        slim.recipient = self.permalink
        slim.received = true
        self.actions.createObject(slim, done)
      }, err => {
        if (err) return cb(err)
        if (seal) self.watchSeal(seal)

        cb(null, wrappers)
      })
    })
  })
}

/**
 * Create a blockchain seal for an object
 *
 * @param  {Object}   opts
 * @param  {Object}   [opts.object]                      the object to send
 * @param  {String}   [opts.link]                        a link to the object to send
 * @param  {Object}   [opts.basePubKey=this.chainPubKey] [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {Number}   [opts.amount]                      amount to spend on the transaction
 * @param  {Function} cb   [description]
 */
proto.seal = function seal (opts, cb) {
  const self = this

  typeforce({
    object: typeforce.maybe(types.signedObject),
    link: typeforce.maybe(typeforce.String),
    basePubKey: typeforce.maybe(types.chainPubKey),
    amount: typeforce.maybe(typeforce.Number)
  }, opts)

  if (!(opts.object || opts.link)) {
    throw new Error('expected "object" or "link"')
  }

  const object = opts.object
  const link = opts.link || utils.hexLink(object)
  const basePubKey = opts.basePubKey || this.chainPubKey
  const sealPubKey = protocol.sealPubKey({
    link: utils.linkToBuf(link),
    basePubKey: basePubKey
  })

  const sealAddress = utils.pubKeyToAddress(sealPubKey, this.networkName)
  // const uid = utils.sealUID({ link, sealPubKey })
  this.seals.findOne('sealAddress', sealAddress, function (err, seal) {
    if (err && !err.notFound) return cb(err)
    if (seal) return cb(new errors.SealExists(seal))

    // make sure we have this object
    // if not, require createObject to be called first
    self.keeper.get(link, function (err, object) {
      if (err) return cb(err)

      let sealPrevPubKey, sealPrevAddress
      if (object[PREVLINK]) {
        sealPrevPubKey = protocol.sealPrevPubKey({
          basePubKey: basePubKey,
          prevLink: utils.linkToBuf(object[PREVLINK])
        })

        sealPrevAddress = utils.pubKeyToAddress(sealPrevPubKey, self.networkName)
      }
      // const sealPrevAddress = sealPrevPubKey &&
      //   utils.sealPrevAddress(basePubKey, link, self.networkName)

      self.actions.writeSeal({
        link,
        prevLink: object[PREVLINK],
        basePubKey,
        sealAddress,
        sealPrevAddress,
        sealPubKey,
        sealPrevPubKey,
        amount: opts.amount,
        networkName: self.networkName
      }, cb)

      self.watchSeal({ link, basePubKey })
    })
  })
}

/**
 * Monitor the blockchain for a seal announcing a new version of the object with link `link`
 *
 * @param  {Object}   opts
 * @param  {String}   opts.link   link to the object to monitor
 * @param  {Object}   opts.basePubKey [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {Function} cb
 */
proto.watchNextVersion = function (opts, cb) {
  typeforce({
    link: typeforce.String,
    basePubKey: types.chainPubKey
  }, opts)

  this._watch({
    // the next version's previous is the current version
    // the tx for next version will have a predictable seal based on the current version's link
    address: utils.sealPrevAddress(opts.basePubKey, opts.link, this.networkName),
    basePubKey: opts.basePubKey,
    link: opts.link,
    watchType: constants.watchType.nextVersion
  }, cb)
}

/**
 * Monitor the blockchain for a seal for the object with link `link`
 *
 * @param  {Object}   opts
 * @param  {String}   opts.link   link to the object to monitor
 * @param  {Object}   opts.basePubKey [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {Function} cb
 */
proto.watchSeal = function (opts, cb) {
  typeforce({
    link: typeforce.String,
    basePubKey: types.chainPubKey
  }, opts)

  this._watch({
    address: utils.sealAddress(opts.basePubKey, opts.link, this.networkName),
    basePubKey: opts.basePubKey,
    link: opts.link,
    watchType: constants.watchType.thisVersion
  }, cb)
}

/**
 * watch an address for a seal for an object's current or next version
 *
 * @private
 * @param  {Object}   opts
 * @param  {String}   opts.link       link to the object to monitor
 * @param  {Object}   opts.basePubKey [sealer's blockchain pubKey]{@link types#chainPubKey}
 * @param  {String}   opts.watchType  [watch type]{@link constants#watchType}
 * @param  {String}   [opts.address]  address at which to expect seal
 * @param  {Function} cb
 */
proto._watch = function (opts, cb) {
  const self = this

  typeforce({
    link: typeforce.String,
    basePubKey: types.chainPubKey,
    watchType: typeforce.String,
    address: typeforce.maybe(typeforce.String)
  }, opts, true)

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

    self.actions.createWatch(opts, cb)
  })
}

/**
 * Override this method to provide delivery of messages
 *
 * @param  {Buffer}   msg
 * @param  {Object}   [recipientInfo]{@link types.identityInfo}
 * @param  {Function} cb
 */
proto._send = function _send (msg, recipientInfo, cb) {
  throw new Error('implement this method yourself')
}

/**
 * Execute a function after initialization is complete
 *
 * @private
 * @param  {Function} fn
 */
proto._onready = function (fn) {
  if (this._ready) return fn()

  this.once('ready', fn)
}

/**
 * Terminate all internal activity and close database handles
 *
 * @param  {Function} cb
 */
proto.destroy = function destroy (cb) {
  cb = cb || noop
  if (this._destroyed) throw new Error('already destroying or destroyed')
  if (!this._ready) return this.once('ready', () => this.destroy())

  this._destroyed = true
  this._debug('self-destructing')
  this._exec('stop')
  const dbs = Object.keys(this.dbs).map(k => this.dbs[k])
    .concat(this._logDB)
    .concat(this.keeper)

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
 *
 * @param  {Function} cb
 */
proto.sync = function (cb) {
  this.sealwatch.sync(cb)
}
