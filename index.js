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
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const CUR_HASH = constants.CUR_HASH
const indexFeed = require('./lib/index-feed')
const utils = require('./lib/utils')
const createSealWatcher = require('./lib/sealwatch')
const createAddressBook = require('./lib/addressBook')
const createSealer = require('./lib/sealer')
const createSender = require('./lib/sender')
const topics = require('./lib/topics')
const createLiveQueue = require('./lib/queue')
const statuses = require('./lib/status')
const types = require('./lib/types')
const logs = require('./lib/logs')
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

  const dir = opts.dir
  const dbOpts = { db: opts.leveldown }
  const log = logs(path.join(dir, 'log.db'), dbOpts)
  // const ixf = this._ixf = indexFeed({
  //   changes: changes,
  //   db: path.join(dir, 'index.db'),
  //   leveldown: opts.leveldown
  // })

  // ixf.index.add(function (row, cb) {
  //   // TODO: pick and choose properties to index (as opposed to every property)
  //   cb(null, row.value)
  //   // switch (row.topic) {
  //   // case topics.seal:
  //   //   return cb(null, row.value)
  //   // case topics.msg:
  //   //   return cb(null, row.value)
  //   // }
  // })

  extend(this, opts)

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

  const chaintracker = trackchain({
    db: levelup(path.join(dir, 'chain'), {
      db: opts.leveldown,
      valueEncoding: 'json'
    }),
    blockchain: blockchain,
    networkName: networkName,
    confirmedAfter: 10 // stop tracking a tx after 10 blocks
  })

  const sealwatch = createSealWatcher({
    chaintracker: chaintracker,
    ixf: ixf,
    syncInterval: opts.syncInterval
  })

  reemit(this, sealwatch, ['seal', 'error'])

  const sealer = createSealer({
    ixf: ixf,
    transactor: opts.transactor
  })

  reemit(this, sealer, ['sealed', 'error'])

  const sender = createSender({
    ixf: ixf,
    send: () => this._send.apply(this, arguments)
  })

  reemit(this, sender, ['sent', 'error'])

  const addressBook = this.addressBook = createAddressBook({
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

proto.addContact = function addContact (identity, cb) {
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
  cb = utils.asyncify(cb)

  typeforce({
    recipient: protocol.types.recipient
  }, opts)

  const rPubKey = opts.recipient.pubKey
  let rLink, oLink, mLink, msg, msgID

  const checkSent = (msgID, done) => {
    getMsg(this._ixf, msgID, err => {
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
    function checkAlreadySent (result, done) {
      msg = result.object
      oLink = utils.hex(protocol.link(object))
      mLink = utils.hex(protocol.link(msg))
      msgID = utils.getMsgID({
        // TODO: add prev, to make msgID unique
        message: mLink,
        object: oLink,
        recipient: rLink,
        sender: self.permalink
      })

      checkSent(msgID, done)
    },
    function putData (done) {
      saveMessageToKeeper(self.keeper, msg, mLink, oLink, done)
    },
    function log (mLink, oLink, done) {
      ixf.db.put(msgID, {
        topic: topics.msg,
        msgID: msgID,
        object: oLink,
        message: mLink,
        sender: self.permalink,
        recipient: rLink,
        type: object[TYPE],
        sendstatus: statuses.send.unsent
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
        sender: getIdentityLink(identityInfo),
        recipient: self.permalink,
        link: mLink
      })

      // TODO: check exists?
      saveMessageToKeeper(self.keeper, msg, mLink, oLink, done)
    },
    function log (done) {
      this._ixf.db.put(msgID, {
        topic: topics.msg,
        msgID: msgID,
        [CUR_HASH]: oLink,
        [ROOT_HASH]: object[ROOT_HASH] || oLink,
        [PREV_HASH]: object[PREV_HASH],
        message: mLink,
        recipient: self.permalink,
        sender: sLink,
        type: object[TYPE],
        receivestatus: statuses.receive.received
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
  typeforce({
    amount: 'number',
    object: 'object'
  }, opts)

  const object = opts.object
  const link = protocol.link(object)
  const prevLink = protocol.prevSealLink(object)
  const toPubKey = opts.pubKey || this.chainPubKey
  const sealID = utils.getSealID({
    link: link,
    toPubKey: toPubKey
  })

  getSeal(this._ixf, sealID, (err, seal) => {
    if (seal) return cb()

    keeper.putOne(oLink, object)
    .then(() => {
      this._ixf.db.put(sealID, {
        topic: topics.seal,
        sealID: sealID,
        link: link,
        prevLink: prevLink,
        type: object[TYPE],
        basePubKey: toPubKey,
        amount: opts.amount,
        sealstatus: statuses.seal.unsealed
      }, cb)
    }, cb)
  })
}

proto.watch = function (addr, link, cb) {
  const watchID = utils.getWatchID({
    address: addr,
    link: link
  })

  getWatch(this._ixf, watchID, (err, val) => {
    if (val) return cb()

    this._ixf.db.put(watchID, {
      topic: topics.watch,
      watchID: watchID,
      address: addr,
      link: link,
      watchstatus: statuses.watch.unseen
    }, cb)
  })
}

proto._send = function () {
  throw new Error('implement this one yourself')
}

proto.destroy = function () {
  sealwatch.stop()
  sealer.stop()
  sender.stop()
}

function getWatch (ixf, watchID, cb) {
  ixf.index.firstWithValue('watchID', watchID, cb)
}

function getSeal (ixf, sealID, cb) {
  ixf.index.firstWithValue('sealID', sealID, cb)
}

function getMsg (ixf, msgID, cb) {
  ixf.index.firstWithValue('msgID', msgID, cb)
}

function toBuffer (object) {
  if (Buffer.isBuffer(object)) return object
  if (typeof object === 'object') object = protocol.stringify(object)
  if (typeof object === 'string') object = new Buffer(object)

  return object
}

function getIdentityLink (identityInfo) {
  return new Buffer(identityInfo[ROOT_HASH], 'hex')
}

function saveMessageToKeeper (keeper, msg, mLink, oLink, cb) {
  keeper.putMany([
    { key: utils.hex(oLink), value: toBuffer(msg.object) },
    { key: utils.hex(mLink), value: toBuffer(msg) }
  ])
  .nodeify(cb)
}
