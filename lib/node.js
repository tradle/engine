'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const path = require('path')
const extend = require('xtend/mutable')
const clone = require('xtend')
const reemit = require('re-emitter')
const typeforce = require('typeforce')
const trackchain = require('chain-tracker')
const async = require('async')
const debug = require('debug')('tradle:node')
const protocol = require('@tradle/protocol')
const changesFeed = require('changes-feed')
// const subdown = require('subleveldown')
const tradle = require('../')
const createActions = require('./actions')
const constants = require('./constants')
const errors = require('./errors')
const statuses = require('./status')
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
const MAX_CONFIRMATIONS = 10
const noop = () => {}
const DEFAULT_OPTS = {
  syncInterval: 10 * 60 * 1000 // every 10 mins
}

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
    syncInterval: typeforce.maybe(types.Number)
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
  this._authorOpts = {
    sigPubKey: this.sigPubKey,
    sign: this.sigKey.sign.bind(this.sigKey)
  }

  this._recipientOpts = {
    pubKey: this.sigPubKey,
    link: this.permalink
  }

  this.actions = createActions({ changes })

  // init dbs
  const ldb = this._dataDB = utils.levelup(path.join(dir, 'tradle.db'), this._levelOpts)
  this.objects = createDB.objects({
    changes: changes,
    // db: subdown(ldb, 'o'),
    db: utils.levelup(path.join(dir, 'objects.db'), this._levelOpts),
    keeper: this.keeper,
    identityInfo: this.identityInfo
  })

  this.seals = createDB.seals({
    changes: changes,
    // db: subdown(ldb, 's'),
    db: utils.levelup(path.join(dir, 'seals.db'), this._levelOpts),
    keeper: this.keeper
  })

  this.watches = createDB.watches({
    changes: changes,
    db: utils.levelup(path.join(dir, 'watches.db'), this._levelOpts),
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
    // db: subdown(ldb, 'a')
  })

  this._trackchain(opts.chaintracker)

  // init various queues
  this.sealer = createSealer({
    db: this.seals,
    transactor: this.transactor,
    actions: this.actions,
    seals: this.seals
  })

  reemit(this, this.sealer, ['sealed', 'error'])

  this.sender = createSender({
    objects: this.objects,
    send: function () {
      return self._send.apply(self, arguments)
    },
    actions: this.actions,
    addressBook: this.addressBook
  })

  reemit(this, this.sender, ['sent', 'error'])

  // this.setIdentity(this.identity)

  // misc

  this.validator = createValidator({
    node: this
  })

  this.sealwatch.start()
  this.sealer.start()
  this.sender.start()
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)
const proto = Tradle.prototype

proto.sign = function sign (object, cb) {
  const author = this._authorOpts
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
  async.series([
    checkExists,
    putData,
    createAction
  ], cb)

  function checkExists (done) {
    async.parallel(identity.pubkeys.map(function (key) {
      return function (taskCB) {
        self.addressBook.lookupIdentity(key.fingerprint, function (err, val) {
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

proto.saveObject = function saveObject (opts, cb) {
  const self = this

  typeforce({
    object: types.signedObject
  }, opts)

  const object = opts.object
  const wrapper = { object }

  utils.addLinks(wrapper)
  const uid = utils.uid(wrapper)
  async.series([
    checkExists,
    augment,
    createAction
  ], cb)

  function checkExists (done) {
    self.objects.byUID(uid, function (err) {
      if (!err) return done(new errors.ObjectExists(wrapper))

      done()
    })
  }

  function augment (done) {
    async.parallel([
      save,
      checkSealed
    ], done)
  }

  function save (onsaved) {
    self.keeper.put(wrapper.link, object, onsaved)
  }

  function checkSealed (onchecked) {
    self.seals.first('link', wrapper.link, function (err, seal) {
      if (err) return onchecked()

      wrapper.sealstatus = SealStatus.sealed
      wrapper.seal = seal.uid
      wrapper.txId = seal.txId
      wrapper.confirmations = seal.confirmations
      wrapper.basePubKey = seal.basePubKey
      onchecked()
    })
  }

  function createAction (done) {
    wrapper.author = self.permalink
    self.actions.createObject(wrapper, done)
  }
}

proto.createObject = function createObject (opts, cb) {
  const self = this
  typeforce({
    object: types.rawObject
  }, opts)

  this.sign(opts.object, function (err) {
    if (err) return cb(err)

    self.saveObject(opts, cb)
  })
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
    utils.getBody.bind(this.keeper, utils, oLink, object),
    function maybeCreateObject (body, done) {
      object = body
      const fn = object[SIG] ? self.saveObject : self.createObject
      fn.call(self, { object }, function (err) {
        if (err && err.type === errors.Exists.type) err = null

        done(err)
      })
    },
    function lookupRecipient (done) {
      self.addressBook.lookupIdentity(utils.pubKeyString(recipientPubKey), done)
    },
    function createMessage (identityInfo, done) {
      const author = self._authorOpts
      protocol.message({ object, author, recipientPubKey }, done)
    },
    function checkStatuses (result, done) {
      const msg = result.object
      msg.author = self.permalink
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
  async.each(wrappers, function validate (wrapper, done) {
    async.series([
      // taskCB => utils.loadBG(self, wrapper, taskCB),
      taskCB => validator.validate(wrapper, taskCB)
    ], done)
  }, function (err) {
    if (err) return cb(err)

    utils.saveToKeeper(self.keeper, wrappers, function (err) {
      if (err) return cb(err)

      async.each(wrappers, function log (done) {
        wrapper.author = wrapper.author.permalink
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
    amount: typeforce.Number,
    object: typeforce.maybe(typeforce.Object),
    link: typeforce.maybe(typeforce.String),
    basePubKey: typeforce.maybe(types.chainPubKey)
  }, opts)

  const object = opts.object
  const link = opts.link || utils.hexLink(object)
  const basePubKey = opts.basePubKey || this.chainPubKey
  const sealPubKey = protocol.sealPubKey({
    link: link,
    basePubKey: basePubKey
  })

  const sealAddress = utils.pubKeyToAddress(sealPubKey)
  // const uid = utils.sealUID({ link, sealPubKey })
  this.seals.search('sealAddress', sealAddress, function (err, seals) {
    if (err) return cb(err)
    if (seals.length) return cb(new errors.SealExists(seals[0]))

    // make sure we have this object
    // if not, require createObject to be called first
    self.keeper.get(link, function (err, object) {
      if (err) return cb(err)

      const sealPrevPubKey = object[PREVLINK] && protocol.sealPrevPubKey({
        object: object,
        basePubKey: basePubKey
      })

      self.actions.writeSeal({
        link,
        basePubKey,
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

  const uid = utils.watchUID(opts)
  async.parallel([
    function checkExistingWatch (done) {
      self.watches.get(uid, function (err, watch) {
        if (watch) return done(new errors.WatchExists({ uid }))

        done()
      })
    },
    function checkExistingSeal (done) {
      const type = opts.watchType
      const prop = type === constants.watchType.thisVersion ? 'sealAddress' : 'sealPrevAddress'
      self.seals.search(prop, opts[prop], function (err, seals) {
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
    this._logDB.close,
    this._dataDB.close
  ], cb)
}

proto.sync = function () {
  this.chaintracker.sync()
}

proto._trackchain = function _trackchain (chaintracker) {
  const self = this
  if (this.chaintracker) return

  this.chaintracker = chaintracker = chaintracker || trackchain({
    db: utils.levelup(path.join(this.dir, 'chain.db'), {
      db: this.leveldown,
      valueEncoding: 'json'
    }),
    blockchain: this.blockchain,
    networkName: this.networkName,
    confirmedAfter: 10 // stop tracking a tx after 10 blocks
  })

  const sealwatch = this.sealwatch = createSealWatcher({
    watches: this.watches,
    actions: this.actions,
    // db: utils.levelup(path.join(this.dir, 'chain'), this._levelOpts),
    chaintracker: this.chaintracker,
    syncInterval: this.syncInterval
  })

  sealwatch.start()

  reemit(this, sealwatch, ['seal', 'error'])
}

// function toBuffer (object) {
//   if (Buffer.isBuffer(object)) return object
//   if (typeof object === 'object') object = protocol.stringify(object)
//   if (typeof object === 'string') object = new Buffer(object)

//   return object
// }
