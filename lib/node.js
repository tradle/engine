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
const tradle = require('../')
const constants = require('./constants')
const Actions = require('./actions')
const errors = require('./errors')
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const createValidator = require('./validator')
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const utils = tradle.utils
const createSealWatcher = tradle.sealwatch
const createAddressBook = tradle.addressBook
const createSealer = tradle.sealer
const createSender = tradle.sender
const topics = tradle.constants.topics
const createLiveQueue = tradle.queue
const Status = tradle.constants.status
const types = tradle.types
const MAX_CONFIRMATIONS = 10
const noop = () => {}

function Tradle (opts) {
  if (!(this instanceof Tradle)) return new Tradle (opts)

  typeforce({
    networkName: typeforce.String,
    dir: typeforce.String,
    blockchain: typeforce.Object,
    identity: types.identity,
    keeper: types.keeper,
    keys: typeforce.Array,
    leveldown: types.leveldown,
    wallet: typeforce.maybe(typeforce.Object),
    transactor: typeforce.maybe(types.transactor)
  }, opts, true)

  extend(this, opts)
  this.opts = opts

  const dir = opts.dir
  this._levelOpts = { db: opts.leveldown }

  const logDB = utils.levelup(path.join(dir, 'log.db'), this._levelOpts)
  const changes = changesFeed(logDB)
  const networkName = opts.networkName
  const blockchain = opts.blockchain
  const keeper = opts.keeper
  const identity = opts.identity
  const pubKeys = this.pubKeys = identity.pubkeys.map(key => {
    if (key.type === 'ec') {
      return utils.toECKeyObj(key)
    } else {
      return key
    }
  })

  const keys = opts.keys
  this.sigKey = utils.sigKey(keys)
  this.chainPubKey = utils.chainPubKey(identity)
  this.sigPubKey = utils.sigPubKey(identity)
  this._currentLink = protocol.link(this.identity)
  this.permalink = this.identity[PERMALINK] ? utils.linkToBuf(this.identity[PERMALINK]) : this._currentLink
  this._authorOpts = {
    sigPubKey: this.sigPubKey,
    sign: this.sigKey.sign.bind(this.sigKey)
  }

  this._recipientOpts = {
    pubKey: this.sigPubKey,
    link: this.permalink
  }

  this.actions = createActions({ changes: this.changes })
  this._trackchain(opts.chaintracker)

  this.objectDB = createObjectDB({
    changes: changes,
    db: utils.levelup(path.join(dir, 'msg.db'), this._levelOpts),
    keeper: keeper
  })

  this.sealer = createSealer({
    objectDB: this.objectDB,
    transactor: opts.transactor,
    actions: this.actions
  })

  reemit(this, this.sealer, ['sealed', 'error'])

  this.sender = createSender({
    objectDB: objectDB,
    send: () => this._send.apply(this, arguments),
    actions: this.actions
  })

  reemit(this, this.sender, ['sent', 'error'])

  this.addressBook = createAddressBook({
    keeper: keeper
  })

  // this.setIdentity(this.identity)

  this.validator = createValidator({
    addressBook: this.addressBook,
    keeper: this.keeper,
    objectDB: this.objectDB,
    identity: this.identity
  })
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
  // let batch
  let link = utils.hexLink(identity)
  async.waterfall([
    function checkExists (done) {
      async.parallel(identity.pubkeys.map(function (key) {
        return function (done) {
          self.addressBook.byPubKey(key, function (err, val) {
            done(val ? new Error('collision') : null)
          })
        }
      }), done)
    },
    function putData (done) {
      // batch = utils.identityBatch(identity)
      // link = batch[LINK]
      self.keeper.put(link, identity, done)
    },
    function log (done) {
      self.actions.addContact(identity, link, done)
    }
  ], cb)
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
    function objectExists (done) {
      self.objectDB.byUID(uid, function (err) {
        if (!err) return done(new errors.ObjectExists(wrapper))

        done()
      })
    },
    function save (done) {
      self.keeper.put(wrapper.link, object, done)
    },
    function log (done) {
      wrapper.author = self.permalink
      self.actions.createObject(wrapper, done)
    }
  ], cb)
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
    object: typeforce.maybe(typeforce.Object),
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
    utils.getBody.bind(utils, oLink, object),
    function maybeCreateObject (body, done) {
      object = body
      const fn = object[SIG] ? self.saveObject : self.createObject
      fn.call(self, { object }, function (err) {
        if (err && err.type === errors.Exists.type) err = null

        done(err)
      })
    },
    function lookupRecipient (done) {
      self.addressBook.lookupIdentity({ pubKey: recipientPubKey }, done)
    }
    function createMessage (identityInfo, done) {
      const author = this._authorOpts
      protocol.message({ object, recipientPubKey, author }, done)
    },
    function checkStatuses (result, done) {
      const msg = result.object
      msg.author = self.permalink
      self.createObject(msg, done)
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
  let sender, msgID, mLink, oLink, sLink

  const wrappers = [
    { object },
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
      taskCB => utils.loadBG(wrapper, taskCB),
      taskCB => validator.validate(wrapper, taskCB)
    ], done)
  }, function (err) {
    if (err) return cb(err)

    utils.saveToKeeper(self.keeper, wrappers, function (err) {
      if (err) return cb(err)

      async.each(wrappers, function log (done) {
        wrapper.author = wrapper.author[PERMALINK]
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

  const uid = utils.sealUID({ link, sealPubKey })
  this.objectDB.hasSeal(uid, function (err, exists) {
    if (err) return cb(err)
    if (exists) return cb(new errors.SealExists({ uid: uid }))

    // make sure we have this object
    // if not, require createObject to be called first
    self.keeper.get(link, function (err, object) {
      if (err) return cb(err)

      const sealPrevPubKey = object[PREVLINK] && protocol.sealPrevPubKey({
        object: object,
        basePubKey: basePubKey
      })

      self.actions.createSeal({
        link,
        basePubKey,
        sealPubKey,
        sealPrevPubKey,
        amount: opts.amount,
        networkName: self.networkName
      })

      self.watch(utils.pubKeyToAddress(sealPubKey), link)
    })
  })
}

proto.watch = function (opts, cb) {
  typeforce({
    address: typeforce.maybe(typeforce.String),
    basePubKey: typeforce.maybe(types.chainPubKey),
    link: typeforce.String
  }, opts, true)

  const link = utils.linkToBuf(opts.link)
  let address = opts.address
  if (!address) {
    if (opts.basePubKey) {
      address = utils.sealAddress(opts.basePubKey, link)
    } else {
      throw new Error('unable to deduce seal address')
    }
  }

  return this.watchAddress(address, link, cb)
}

proto.watchAddress = function watchAddress (sealAddress, link, cb) {
  const self = this

  async.parallel([
    function checkExistingWatch (done) {
      const watchID = utils.watchUID({
        address: addr,
        link: link
      })

      self.objectDB.getWatch(watchID, function (err, watch) {
        if (watch) return done(new errors.WatchExists({ link, address }))

        done()
      })
    },
    function checkExistingSeal (done) {
      const sealUID = utils.sealUID({ link, sealAddress })
      self.objectDB.getSeal(sealUID, function (err, seal) {
        if (seal) return done(new errors.SealExists({ uid }))

        done()
      })
    }
  ], function (err) {
    if (err) return cb(err)

    self.actions.createWatch({
      address: addr,
      link: link
    }, cb)
  })
}

proto._send = function _send () {
  throw new Error('implement this one yourself')
}

proto.destroy = function destroy () {
  this.sealwatch.stop()
  this.sealer.stop()
  this.sender.stop()
}

proto.sync = function () {
  this.chaintracker.sync()
}

proto._trackchain = function _trackchain (chaintracker) {
  const self = this
  if (this.chaintracker) return

  this.chaintracker = chaintracker = chaintracker || trackchain({
    db: utils.levelup(path.join(this.dir, 'chain'), {
      db: this.leveldown,
      valueEncoding: 'json'
    }),
    blockchain: this.blockchain,
    networkName: this.networkName,
    confirmedAfter: 10 // stop tracking a tx after 10 blocks
  })

  const sealwatch = this.sealwatch = createSealWatcher({
    db: utils.levelup(path.join(this.dir, 'chain'), this._levelOpts),
    chaintracker: this.chaintracker,
    syncInterval: this.syncInterval
  })

  reemit(this, sealwatch, ['seal', 'error'])

  this.chaintracker.on('txs', txInfos => {
    async.each(txInfos, function processTx (txInfo, cb) {
      this.sealwatch.getTxWithID(txInfo.txId, function (err, tx) {
        if (tx) {
          if (tx.confirmations > MAX_CONFIRMATIONS) return cb()
        }

        // const confirmed = (txInfo.confirmations || 0) >= CONFIRMATIONS
        self.actions.saveTx(txInfo, cb)
      })
    }), function (err) {
      if (err) debug('failed to process incoming txs', err)
    })
  })
}

// function toBuffer (object) {
//   if (Buffer.isBuffer(object)) return object
//   if (typeof object === 'object') object = protocol.stringify(object)
//   if (typeof object === 'string') object = new Buffer(object)

//   return object
// }
