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
    name: typeforce.maybe(typeforce.String)
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

  this.seals.on('readseal', function (seal) {
    if (!seal.sealAddress) {
      self.emit('newversionseal', seal)
    }
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

  this.addContact(this.identity)

  this.sealwatch = createSealWatcher(this)
  reemit(this.sealwatch, this, ['seal', 'error'])

  // init various queues
  if (this.transactor) {
    this.sealer = createSealer(this)
    reemit(this.sealer, this, ['sealed', 'error'])
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

  reemit(this.sender, this, ['sent', 'error'])

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
      let link = state.link
      if (event === 'readseal' && !link) {
        event = 'nextversion'
        link = state.prevLink
      }

      this.keeper.get(link, (err, body) => {
        if (err) {
          this._debug(`missing object ${state.link}`)
          return this.emit('error', err)
        }

        state.object = body
        this.emit(event, state)
      })
    })
  })

  this._exec('start')
  // utils.lockify(this, ['createObject', 'addContact'])
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)
const proto = Tradle.prototype

proto._debug = function () {
  utils.subdebug(debug, this.name || this.shortlink, arguments)
}

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

// proto.getRecipientPubKey = function (recipientLink, cb) {
//   this.addressBook.lookupIdentity({
//     [PERMALINK]: recipientLink
//   }, function (err, identityInfo) {
//     if (err) return cb(err)

//     const pubKey = utils.messagingPubKey(identityInfo.object)
//     if (!pubKey) cb(new Error('no suitable pubkey found'))
//     else cb(null, pubKey)
//   })
// }

proto.addContactIdentity =
proto.addContact = function addContact (identity, cb) {
  const self = this

  typeforce(types.identity, identity)
  cb = cb || noop

  let link = utils.hexLink(identity)
  const indexes = identity.pubkeys.map(key => {
    return { fingerprint: key.fingerprint }
  })
  .concat(identity.pubkeys.map(key => {
    return { pubKey: key.pub }
  }))

  let existing

  async.series([
    checkExists,
    putData,
    createAction,
    saveObject
  ], cb)

  function checkExists (done) {
    if (identity === self.identity) return done()

    async.find(indexes, function (indexVal, taskCB) {
      self.addressBook.lookupIdentity(indexVal, function (err, match) {
        existing = existing || match
        taskCB(err, !!match)
      })
    }, function (err) {
      if (err || !existing) return done()
      if (identity[PREVLINK] === existing.link || deepEqual(existing.object, identity)) {
        return done()
      }

      done(new Error('collision'))
    })
  }

  function putData (done) {
    if (existing) return done()

    self.keeper.put(link, identity, done)
  }

  function createAction (done) {
    if (existing) return done()

    self.actions.addContact(identity, link, done)
  }

  function saveObject (done) {
    if (existing) return done()

    self.saveObject({
      object: identity,
      author: link
    }, done)
  }
}

/**
 * saves an object
 * triggers Action: createObject
 */
proto.saveObject = function saveObject (wrapper, cb) {
  const self = this

  typeforce({
    object: types.signedObject,
    author: typeforce.String
  }, wrapper)

  utils.addLinks(wrapper)
  const object = wrapper.object
  const link = wrapper.link
  if (this._saving[link]) {
    return cb(new errors.AlreadySaving(wrapper))
  }

  this._saving[link] = true

  this._debug(`${symbols.save} 1. check existence`)

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
    self.validator.validate(wrapper, done)
  }

  function finish (err) {
    delete self._saving[link]
    self._debug(`${symbols.save} queued`, err || '')
    if (err) cb(err)
    else cb(null, wrapper)
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
    wrapper.author = wrapper.author.permalink
    self.actions.createObject(wrapper, done)
  }
}

/**
 * signs and saves an object
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
    self.saveObject(opts, cb)
  })
}

proto.signAndSend = function (opts, cb) {
  this.sign(opts, (err, result) => {
    if (err) return cb(err)

    opts.object = result.object
    this.send(opts, cb)
  })
}

proto.send = function send (opts, cb) {
  const self = this

  typeforce({
    object: typeforce.maybe(types.signedObject),
    link: typeforce.maybe(typeforce.String),
    to: types.identifier
  }, opts)

  let recipientPubKey = opts.to.pubKey
  let recipientLink = opts.to.link
  let object = opts.object
  let oLink = opts.link
  if (!(object || oLink)) throw new Error('expected "object" or "link"')

  oLink = oLink || utils.hexLink(object)
  let wrapper

  async.waterfall([
    function getBody (done) {
      self._debug(`${symbols.send} 1. get body`)
      if (object) return done(null, object)

      self.keeper.get(oLink, done)
    },
    function maybeCreateObject (body, done) {
      self._debug(`${symbols.send} 2. maybe create object`)
      object = body
      const method = object[SIG] ? 'saveObject' : 'createObject'
      const author = self.permalink
      self[method]({ object, author }, function (err) {
        if (err && err.type === errors.ObjectExists.type) err = null

        done(err)
      })
    },
    function lookupRecipient (done) {
      self._debug(`${symbols.send} 3. lookup recipient`)
      self.addressBook.lookupIdentity(opts.to, done)
    },
    function getNextID (identityInfo, done) {
      if (!recipientLink) recipientLink = identityInfo.link
      if (!recipientPubKey) recipientPubKey = utils.sigPubKey(identityInfo.object)
      self.objects.nextMessageMetadata({ with: recipientLink }, done)
    },
    // get next `seq` and link to prev message
    function createMessage (meta, done) {
      self._debug(`${symbols.send} 4. create message`)
      const author = self._authorOpts
      protocol.message({
        author,
        body: utils.extend({
          object,
          recipientPubKey
        }, meta)
      }, done)
    },
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
    function saveObject (result, done) {
      self._debug(`${symbols.send} 5. save object`)
      wrapper = {
        object: result.object,
        author: self.permalink,
        recipient: recipientLink
      }

      self.saveObject(wrapper, done)
    }
  ], function (err) {
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
}

proto.conversation = function (opts, cb) {
  return this.objects.conversation(opts, cb)
}

proto.forget = function forget (link, cb) {
  const self = this

  this._debug('forgetting correspondence with ' + link)

  let count = 0
  const stream = this.conversation({
    with: link,
    body: false
  })
  .pipe(map(function (data, done) {
    count++
    self.actions.forgetObject(data.link, done)
  }))

  collect(stream, function (err, links) {
    if (err) return cb(err)

    self._debug(`forgot ${count} messages`)
    cb()
  })
}

proto._exec = function _exec (method) {
  if (this.sealer) this.sealer[method]()
  this.sealwatch[method]()
  this.sender[method]()
}

proto.pause = function (timeout) {
  if (this._paused) return

  this._exec('pause')
}

proto.resume = function () {
  if (!this._paused) return

  this._exec('resume')
}

proto.receive = function receive (msg, from, cb) {
  const self = this
  cb = utils.asyncify(cb)

  try {
    typeforce(types.identifier, from)
    if (Buffer.isBuffer(msg)) {
      msg = protocol.unserializeMessage(msg)
    }
  } catch (err) {
    return cb(err)
  }

  if (msg[PERMALINK] || msg[PREVLINK]) {
    return cb(new Error('messages cannot be versioned'))
  }

  if (!utils.hasPubKey(this.identity, msg.recipientPubKey)) {
    return cb(new Error('recipientPubKey in message is not in this node\'s identity'))
  }

  const object = msg.object
  const addressBook = this.addressBook
  const objects = this.objects
  let sender, msgID, mLink, oLink, sLink

  const wrappers = [
    {
      object
    },
    {
      object: msg,
      // needs to be verified
      author: from
    }
  ];

  // for objects: msg & msg.object
  //   save objects to keeper
  //   check if we know the object's author
  //   check each object follows the rules
  //   log both objects (object, then message)

  const validator = this.validator
  this._debug('receive 1. validate message & embedded object')
  async.each(wrappers, function validate (wrapper, done) {
    async.series([
      // taskCB => utils.loadBG(self, wrapper, taskCB),
      taskCB => validator.validate(wrapper, taskCB)
    ], done)
  }, function (err) {
    if (err) return cb(err)

    self._debug('receive 2. store')
    utils.saveToKeeper(self.keeper, wrappers, function (err) {
      if (err) return cb(err)

      async.each(wrappers, function log (wrapper, done) {
        const slim = utils.clone(wrapper)
        slim.author = slim.author.permalink
        slim.recipient = self.permalink
        slim.received = true
        self.actions.createObject(slim, done)
      }, err => {
        if (err) return cb(err)

        cb(null, {
          object: wrappers[0],
          message: wrappers[1]
        })
      })
    })
  })
}

// proto.verifyObject = function (opts, cb) {
//   const self = this

//   typeforce({
//     author: typeforce.maybe(typeforce.Object),
//     object: typeforce.Object
//   }, opts, true)

//   const author = opts.author
//   const object = opts.object

//   async.waterfall([
//     function lookup (done) {
//       if (author.identity) {
//         done(null, identityInfo)
//       } else {
//         self.addressBook.lookupIdentity(author, done)
//       }
//     },
//     function putData (identityInfo, done) {
//       author = identityInfo
//       sLink = getIdentityLink(identityInfo)
//       try {
//         utils.validateMessage(msg, identityInfo.identity, self.identity)
//       } catch (err) {
//         return done(err)
//       }

//       mLink = utils.hexLink(msg)
//       oLink = utils.hexLink(object)
//       msgID = utils.getMsgID({
//         author: sLink,
//         recipient: self.permalink,
//         link: mLink
//       })

//       // TODO: check exists?
//       saveMessageToKeeper(self.keeper, {
//         [mLink]: msg,
//         [oLink]: object
//       }, done)
//     }
//   ], cb)
// }

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
 * @param  {[type]}   opts [description]
 * @param  {Function} cb   [description]
 * @return {[type]}        [description]
 */
proto._watch = function (opts, cb) {
  const self = this

  typeforce({
    address: typeforce.maybe(typeforce.String),
    basePubKey: types.chainPubKey,
    link: typeforce.String,
    watchType: typeforce.String,
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

proto._send = function _send () {
  throw new Error('implement this method yourself')
}

proto.destroy = function destroy (cb) {
  cb = cb || noop
  if (this._destroyed) throw new Error('already destroying or destroyed')

  this._destroyed = true
  this._debug('self-destructing')
  this._exec('stop')
  const dbs = Object.keys(this.dbs).map(k => this.dbs[k])
    .concat(this._logDB)

  async.each(dbs, function iterator (db, done) {
    db.close(done)
  }, err => {
    if (err) return cb(err)

    cb()
    this.emit('destroy')
  })
}

proto.sync = function (cb) {
  this.sealwatch.sync(cb)
}
