'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const path = require('path')
const extend = require('xtend/mutable')
const clone = require('xtend')
const reemit = require('re-emitter')
const typeforce = require('typeforce')
// const trackchain = require('chain-tracker')
const async = require('async')
const debug = require('debug')('tradle:node')
const protocol = require('@tradle/protocol')
const changesFeed = require('changes-feed')
// const subdown = require('subleveldown')
const tradle = require('../')
const createActions = require('./actions')
const constants = require('./constants')
const symbols = require('./symbols')
const errors = require('./errors')
const statuses = require('./status')
const DEFAULT_OPTS = require('./defaults')
const SealStatus = statuses.seal
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const createValidator = require('./validator')
const TYPE = constants.TYPE
const SIG = constants.SIG
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
    syncInterval: typeforce.maybe(types.Number),
    name: typeforce.maybe(typeforce.String),
    confirmedAfter: typeforce.maybe(types.Number)
  }, opts)

  extend(this, DEFAULT_OPTS, opts)
  this.opts = opts

  const dir = opts.dir
  this._levelOpts = { db: this.leveldown }

  const logDB = this._logDB = utils.levelup(path.join(dir, 'log.db'), this._levelOpts)
  const changes = this.changes = changesFeed(logDB)
  const pubKeys = this.pubKeys = this.identity.pubkeys.map(key => {
    if (key.type === 'ec') {
      return utils.toECKeyObj(key)
    } else {
      return key
    }
  })

  this.identityInfo = utils.objectInfo({
    // would be nice to store/cache this
    object: this.identity
  })

  this.sigKey = utils.sigKey(this.keys)
  this.chainPubKey = utils.chainPubKey(this.identity)
  this.sigPubKey = utils.sigPubKey(this.identity)
  this._currentLink = utils.hexLink(this.identity)
  this.permalink = this.identity[PERMALINK] || this._currentLink
  this.shortlink = utils.shortlink(this.permalink)
  this._authorOpts = {
    sigPubKey: this.sigPubKey,
    sign: this.sigKey.sign.bind(this.sigKey)
  }

  this._recipientOpts = {
    pubKey: this.sigPubKey,
    link: this.permalink
  }

  this.actions = createActions({ changes, node: this })

  // init dbs
  const ldb = this._dataDB = utils.levelup(path.join(dir, 'tradle.db'), this._levelOpts)
  this.objects = createDB.objects({
    name: this.name,
    changes: changes,
    // db: subdown(ldb, 'o'),
    db: utils.levelup(path.join(dir, 'objects.db'), this._levelOpts),
    keeper: this.keeper,
    identityInfo: this.identityInfo
  })

  ;['sent', 'message', 'wroteseal', 'readseal'].forEach(event => {
    this.objects.on(event, state => {
      this.keeper.get(state.link, (err, body) => {
        if (err) {
          this._debug(`missing object ${state.link}`)
          return this.emit('error', err)
        }

        state.object = body
        this.emit(event, state)
      })
    })
  })

  this.seals = createDB.seals({
    changes: changes,
    // db: subdown(ldb, 's'),
    db: utils.levelup(path.join(dir, 'seals.db'), this._levelOpts),
    keeper: this.keeper
  })

  this.seals.on('readseal', function (seal) {
    if (!seal.sealAddress) {
      self.emit('newversionseal', seal)
    }
  })

  this.watches = createDB.watches({
    changes: changes,
    db: utils.levelup(path.join(dir, 'watches.db'), this._levelOpts),
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
    db: utils.levelup(path.join(dir, 'addressBook.db'), this._levelOpts),
    identityInfo: this.identityInfo
    // db: subdown(ldb, 'a')
  })

  // add own identity to addressBook
  this.addContact(this.identity)

  this.sealwatch = createSealWatcher(this)
  reemit(this.sealwatch, this, ['seal', 'error'])

  // init various queues
  this.sealer = createSealer(this)
  reemit(this.sealer, this, ['sealed', 'error'])

  this.sender = createSender({
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

  this.sealwatch.start()
  this.sealer.start()
  this.sender.start()

  // force createObject calls to run
  // sequentially
  utils.lockify(this, ['createObject', 'addContact'])
  // this._saving = {}
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)
const proto = Tradle.prototype

proto._debug = function () {
  utils.subdebug(debug, this.name || this.shortlink, arguments)
}

proto.sign = function sign (opts, cb) {
  protocol.sign({
    object: opts.object,
    author: this._authorOpts
  }, cb)
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
  const indexes = identity.pubkeys.map(key => key.fingerprint)
    .concat(identity.pubkeys.map(key => key.pub))

  async.series([
    checkExists,
    putData,
    createAction
  ], cb)

  function checkExists (done) {
    async.parallel(indexes.map(function (indexVal) {
      return function (taskCB) {
        self.addressBook.lookupIdentity(indexVal, function (err, val) {
          taskCB(val ? new Error('collision') : null)
        })
      }
    }), done)
  }

  function putData (done) {
    self.keeper.put(link, identity, done)
  }

  function createAction (done) {
    self.actions.addContact(identity, link, done)
  }
}

// proto.setIdentity = function (identity, cb) {
//   this.addressBook.get()
// }

/**
 * saves an object
 * triggers Action: createObject
 */
proto.saveObject = function saveObject (opts, cb) {
  const self = this

  typeforce({
    object: types.signedObject
  }, opts)

  const object = opts.object
  const wrapper = { object }

  // cb = utils.asyncify(cb)

  utils.addLinks(wrapper)
  // if (this._saving[wrapper.link]) {
  //   return cb(new errors.AlreadySaving(wrapper))
  // }

  // this._saving[wrapper.link] = true

  // const uid = utils.uid(wrapper)
  async.series([
    checkExists,
    checkPrev,
    augment,
    createAction
  ], function (err) {
    // delete self._saving[wrapper.link]
    self._debug(`${symbols.save} queued`, err || '')
    cb(err)
  })

  function checkExists (done) {
    self._debug(`${symbols.save} 1. check existence`)
    self.objects.get(wrapper.link, function (err) {
      if (!err) return done(new errors.ObjectExists(wrapper))

      done()
    })
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
    self.keeper.put(wrapper.link, object, onsaved)
  }

  function checkSealed (onchecked) {
    self._debug(`${symbols.save} 2a. load seal status`)
    self.seals.findOne('link', wrapper.link, function (err, seal) {
      if (err) return onchecked()

      wrapper.sealstatus = SealStatus.sealed
      wrapper.txId = seal.txId
      wrapper.confirmations = seal.confirmations
      wrapper.basePubKey = seal.basePubKey
      onchecked()
    })
  }

  // function addAuthor (done) {
  //   utils.addAuthor(self, wrapper, done)
  // }

  function createAction (done) {
    self._debug(`${symbols.save} 3. create action "createObject"`)
    // console.log(wrapper)
    // wrapper.author = wrapper.author.permalink
    wrapper.author = self.permalink
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

  this.sign(opts, function (err) {
    if (err) return cb(err)

    self.saveObject(opts, cb)
  })
}

proto.signNSend = function (opts, cb) {
  async.series([
    taskCB => this.sign(opts, taskCB),
    taskCB => this.send(opts, taskCB),
  ], cb)
}

proto.send = function send (opts, cb) {
  const self = this

  typeforce({
    object: typeforce.oneOf(types.object),
    link: typeforce.maybe(typeforce.String),
    recipient: protocol.types.recipient
  }, opts)

  const recipientPubKey = opts.recipient.pubKey
  let object = opts.object
  let oLink = opts.link
  if (!(object || oLink)) throw new Error('expected "object" or "link"')

  oLink = oLink || utils.hexLink(object)
  let rLink, mLink, msg, msgID

  async.waterfall([
    function getBody (done) {
      self._debug(`${symbols.send} 1. get body`)
      if (object) return done(null, object)

      self.keeper.get(oLink, done)
    },
    function maybeCreateObject (body, done) {
      self._debug(`${symbols.send} 2. maybe create object`)
      object = body
      const fn = object[SIG] ? self.saveObject : self.createObject
      fn.call(self, { object }, function (err) {
        if (err && err.type === errors.Exists.type) err = null

        done(err)
      })
    },
    function lookupRecipient (done) {
      self._debug(`${symbols.send} 3. lookup recipient`)
      const pubKeyString = utils.pubKeyString(recipientPubKey)
      self.addressBook.byPubKey(pubKeyString, done)
    },
    function createMessage (identityInfo, done) {
      self._debug(`${symbols.send} 4. create message`)
      const author = self._authorOpts
      protocol.message({ object, author, recipientPubKey }, done)
    },
    function saveObject (result, done) {
      self._debug(`${symbols.send} 5. save object`)
      const msg = result.object
      msg.author = self.permalink
      msg.recipient = opts.recipient.link
      self.saveObject({ object: msg }, done)
    }
  ], cb)
}

// proto.saveObject = function (opts) {
//   typeforce({
//     object: typeforce.Object
//   }, opts)

//   const object = opts.object
//   this.validator.validate(object, function (err) {

//   })
// }

proto.receive = function receive (msg, from, cb) {
  const self = this
  cb = utils.asyncify(cb)

  try {
    typeforce(types.identifier, from)
    msg = protocol.unserializeMessage(msg)
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
        wrapper.author = wrapper.author.permalink
        wrapper.recipient = self.permalink
        wrapper.received = true
        self.actions.createObject(wrapper, done)
      }, cb)
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
        basePubKey,
        sealAddress,
        sealPrevAddress,
        sealPubKey,
        sealPrevPubKey,
        amount: opts.amount,
        networkName: self.networkName
      })

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
  throw new Error('implement this one yourself')
}

proto.destroy = function destroy (cb) {
  this.sealwatch.stop()
  this.sealer.stop()
  this.sender.stop()
  async.parallel([
    taskCB => this._logDB.close(cb),
    taskCB => this._dataDB.close(cb),
  ], cb)
}

proto.sync = function () {
  this.sealwatch.sync()
}
