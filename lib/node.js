'use strict'

const util = require('util')
const EventEmitter = require('events').EventEmitter
const path = require('path')
const extend = require('xtend/mutable')
const reemit = require('re-emitter')
const typeforce = require('typeforce')
const trackchain = require('chain-tracker')
const async = require('async')
const levelup = require('levelup')
const debug = require('debug')('tradle:node')
const tradle = require('../')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const CUR_HASH = constants.CUR_HASH
const PREV_HASH = constants.PREV_HASH
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
    identity: typeforce.Object,
    keeper: typeforce.Object,
    keys: typeforce.Array,
    leveldown: types.leveldown,
    wallet: typeforce.maybe(typeforce.Object),
    transactor: typeforce.maybe(types.transactor)
  }, opts, true)

  extend(this, opts)
  this.opts = opts

  const dir = opts.dir
  this._levelOpts = { db: opts.leveldown, valueEncoding: 'json' }

  const changes = changesFeed(levelup(path.join(dir, 'log.db'), this._levelOpts))
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
  this.permalink = this.identity[ROOT_HASH] ? utils.linkToBuf(this.identity[ROOT_HASH]) : this._currentLink
  this._senderOpts = {
    sigPubKey: this.sigPubKey,
    sign: this.sigKey.sign.bind(this.sigKey)
  }

  this._recipientOpts = {
    pubKey: this.sigPubKey,
    link: this.permalink
  }

  this._trackchain(opts.chaintracker)

  this.msgDB = createMessageDB({
    changes: changes,
    db: levelup(path.join(dir, 'msg.db'), this._levelOpts),
    keeper: keeper
  })

  this.sealer = createSealer({
    msgDB: this.msgDB,
    transactor: opts.transactor
  })

  reemit(this, this.sealer, ['sealed', 'error'])

  this.sender = createSender({
    msgDB: msgDB,
    send: () => this._send.apply(this, arguments)
  })

  reemit(this, this.sender, ['sent', 'error'])

  this.addressBook = createAddressBook({
    keeper: keeper
  })
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)
const proto = Tradle.prototype

proto.sign = function sign (object, cb) {
  protocol.sign({
    object: object,
    sender: this._senderOpts
  }, cb)
}

// proto.getRecipientPubKey = function (recipientLink, cb) {
//   this.addressBook.lookupIdentity({
//     [ROOT_HASH]: recipientLink
//   }, function (err, identityInfo) {
//     if (err) return cb(err)

//     const pubKey = utils.messagingPubKey(identityInfo.identity)
//     if (!pubKey) cb(new Error('no suitable pubkey found'))
//     else cb(null, pubKey)
//   })
// }

proto.addContact =
proto.addContactIdentity = function addContact (identity, cb) {
  const self = this
  typeforce(types.identity, identity)

  cb = cb || noop
  let batch
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
      batch = utils.identityBatch(identity)
      self.keeper.putOne(batch[CUR_HASH], toBuffer(identity)).nodeify(done)
    },
    function log (done) {
      this._ixf.db.batch(batch.batch, done)
    }
  ], cb)
}

proto.send = function (object, opts, cb) {
  const self = this

  typeforce({
    recipient: protocol.types.recipient
  }, opts)

  const rPubKey = opts.recipient.pubKey
  let rLink, oLink, mLink, msg, msgID

  const checkSent = (msgID, done) => {
    this.msgDB.get(msgID, err => {
      // TODO: after adding "prev", there will never be duplicate messages
      // this check will still be needed, but it won't limit the user
      if (!err) return done(new Error('already sent this message before'))

      done()
    })
  }

  async.waterfall([
    this.addressBook.lookupIdentity.bind(this.addressBook, { pubKey: rPubKey }),
    function createMessage (identityInfo, done) {
      rLink = getIdentityLink(identityInfo)
      protocol.message({
        object: object,
        recipientPubKey: rPubKey,
        sender: this._senderOpts
      }, done)
    },
    function checkStatuses (result, done) {
      msg = result.object
      oLink = utils.hexLink(object)
      mLink = utils.hexLink(msg)
      msgID = utils.getMsgID({
        // TODO: add prev, to make msgID unique
        message: mLink,
        object: oLink,
        recipient: rLink,
        sender: self.permalink
      })

      checkSent(msgID, done)
    },
    // function getSealStatus (done) {
    //   async.parallel([
    //     getSeal msg
    //     getSeal object
    //   ], function (err) {

    //   })
    // },
    function putData (done) {
      saveMessageToKeeper(self.keeper, {
        [mLink]: msg,
        [oLink]: object
      }, done)
    },
    function log (done) {
      this.changes.append({
        topic: topics.msg,
        msgID: msgID,
        object: oLink,
        message: mLink,
        sender: self.permalink,
        recipient: rLink,
        type: object[TYPE],
        sendstatus: Status.send.unsent
      }, done)
    }
  ], cb)
}

proto.receive = function (msg, from, cb) {
  const self = this
  cb = utils.asyncify(cb)

  try {
    typeforce(types.identifier, from)
    msg = protocol.unserializeMessage(msg)
  } catch (err) {
    return cb(err)
  }

  if (msg[ROOT_HASH] || msg[PREV_HASH]) {
    return cb(new Error('messages cannot be versioned'))
  }

  const object = msg.object
  let sender, msgID, mLink, oLink, sLink

  async.waterfall([
    function lookup (done) {
      if (from.identity) {
        done(null, identityInfo)
      } else {
        self.addressBook.lookupIdentity(from, done)
      }
    },
    function putData (identityInfo, done) {
      sender = identityInfo
      sLink = getIdentityLink(identityInfo)
      try {
        utils.validateMessage(msg, identityInfo.identity, self.identity)
      } catch (err) {
        return done(err)
      }

      mLink = utils.hexLink(msg)
      oLink = utils.hexLink(object)
      msgID = utils.getMsgID({
        sender: sLink,
        recipient: self.permalink,
        link: mLink
      })

      // TODO: check exists?
      saveMessageToKeeper(self.keeper, {
        [mLink]: msg,
        [oLink]: object
      }, done)
    },
    function log (done) {
      this.changes.append({
        topic: topics.msg,
        msgID: msgID,
        [CUR_HASH]: oLink,
        [ROOT_HASH]: object[ROOT_HASH] || oLink,
        [PREV_HASH]: object[PREV_HASH],
        message: mLink,
        recipient: self.permalink,
        sender: sLink,
        type: object[TYPE],
        // receivestatus: Status.receive.received
      }, done)
    },
  ], err => {
    if (err) return cb(err)

    self.emit('message', {
      message: msg,
      object: object,
      sender: sender
    })

    cb()
  })
}

proto.seal = function (opts, cb) {
  const self = this

  typeforce({
    amount: typeforce.Number,
    object: typeforce.Object
  }, opts)

  const object = opts.object
  const link = utils.hexLink(object)
  const basePubKey = opts.pubKey || this.chainPubKey
  const sealID = utils.getSealID({
    link: link,
    basePubKey: basePubKey
  })

  this.msgDB.hasSealWithID(sealID, function (err, exists) {
    if (err) return cb(err)
    if (exists) return cb(new Error('seal already exists'))

    const sealThis = protocol.sealPubKey({
      link: link,
      basePubKey: basePubKey
    })

    const sealPrev = object[PREV_HASH] && protocol.sealPrevPubKey({
      object: object,
      basePubKey: basePubKey
    })

    self.changes.append({
      topic: topics.seal,
      sealID: sealID,
      sealThis: sealThis,
      sealPrev: sealPrev,
      type: object[TYPE],
      basePubKey: basePubKey,
      amount: opts.amount,
      sealstatus: Status.seal.unsealed
    }, cb)

    self.watch(utils.pubKeyToAddress(sealThis), link)
  })
}

// should every msg/object in msgDB be watched?
proto.watch = function (addr, link, cb) {
  const self = this
  const watchID = utils.getWatchID({
    address: addr,
    link: link
  })

  this.msgDB.watches.get(watchID, function (err, watch) {
    if (watch) return cb(new Error('watch already exists'))

    // check if we have a tx for this
    // status might be seen/confirmed already

    self.changes.append({
      topic: topics.watch,
      watchID: watchID,
      address: addr,
      link: link,
      watchstatus: Status.watch.unseen
    }, cb)
  })
}

proto._send = function () {
  throw new Error('implement this one yourself')
}

proto.destroy = function () {
  this.sealwatch.stop()
  this.sealer.stop()
  this.sender.stop()
}

proto.sync = function () {
  this.chaintracker.sync()
}

proto._trackchain = function (chaintracker) {
  const self = this
  if (this.chaintracker) return

  this.chaintracker = chaintracker = chaintracker || trackchain({
    db: levelup(path.join(this.dir, 'chain'), {
      db: this.leveldown,
      valueEncoding: 'json'
    }),
    blockchain: this.blockchain,
    networkName: this.networkName,
    confirmedAfter: 10 // stop tracking a tx after 10 blocks
  })

  const sealwatch = this.sealwatch = createSealWatcher({
    db: levelup(path.join(this.dir, 'chain'), {
      db: this.leveldown,
      valueEncoding: 'json'
    }),
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
        txInfo.topic = topics.tx
        self.changes.append(txInfo, cb)
      })
    }), function (err) {
      if (err) debug('failed to process incoming txs', err)
    })
  })
}

// function getWatch (ixf, watchID, cb) {
//   ixf.index.firstWithValue('watchID', watchID, cb)
// }

// function getSeal (ixf, sealID, cb) {
//   ixf.index.firstWithValue('sealID', sealID, cb)
// }

// function getMsg (ixf, msgID, cb) {
//   ixf.index.firstWithValue('msgID', msgID, cb)
// }

function toBuffer (object) {
  if (Buffer.isBuffer(object)) return object
  if (typeof object === 'object') object = protocol.stringify(object)
  if (typeof object === 'string') object = new Buffer(object)

  return object
}

function getIdentityLink (identityInfo) {
  typeforce({
    [ROOT_HASH]: typeforce.String
  }, identityInfo)

  return utils.linkToBuf(identityInfo[ROOT_HASH])
}

function saveMessageToKeeper (keeper, props, cb) {
  const batch = Object.keys(props).map(key => {
    return {
      type: 'put',
      key: key,
      value: props.value
    }
  })

  keeper.batch(batch, cb)
}
