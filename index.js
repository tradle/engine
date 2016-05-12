
const util = require('util')
const EventEmitter = require('events').EventEmitter
const path = require('path')
const extend = require('xtend')
const typeforce = require('typeforce')
const trackchain = require('chain-tracker')
const Blockchain = require('cb-blockr')
const async = require('async')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const indexFeed = require('./lib/index-feed')
const utils = require('./lib/utils')
const watchseals = require('./lib/sealwatch')
const createAddressBook = require('./lib/addressBook')
const sealers = require('./lib/sealer')
const topics = require('./lib/topics')
const createLiveQueue = require('./lib/queue')
const statuses = require('./lib/status')
const types = require('./lib/types')

function Tradle (opts) {
  if (!(this instanceof Tradle)) return new Tradle (opts)

  typeforce({
    networkName: typeforce.String,
    dir: typeforce.String,
    blockchain: typeforce.Object,
    identity: typeforce.Object,
    keeper: typeforce.Object,
    keys: typeforce.Array
  }, opts, true)

  const dir = opts.dir
  const ixf = this._ixf = indexFeed({
    log: path.join(dir, 'log.db'),
    index: path.join(dir, 'index.db')
  })

  ixf.index.add(function (row, cb) {
    // TODO: pick and choose properties to index (as opposed to every property)
    cb(null, row.value)
    // switch (row.topic) {
    // case topics.seal:
    //   return cb(null, row.value)
    // case topics.msg:
    //   return cb(null, row.value)
    // }
  })

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
  this._senderOpts = {
    sigPubKey: this.sigPubKey
    sign: this.sigKey.sign.bind(this.sigKey)
  }

  const chaintracker = trackchain({
    db: path.join(dir, 'chain'),
    blockchain: blockchain,
    networkName: networkName,
    confirmedAfter: 10 // stop tracking a tx after 10 blocks
  })

  const sealwatch = watchseals({
    chaintracker: chaintracker,
    ixf: ixf,
    syncInterval: opts.syncInterval
  })

  sealwatch.on('seal', seal => ee.emit('seal', seal))

  const sealer = sealers({
    ixf: ixf,
    transactor: opts.transactor
  })

  const sender = senders({
    ixf: ixf,
    send: () => this._send.apply(this, arguments)
  })

  const addressBook = this.addressBook = createAddressBook({
    idx: ixf,
    keeper: keeper
  })

  ;[sealer, sealwatch, sender].forEach(component => {
    component.on('error', err => self.emit('error', err))
  })

  this._link = protocol.link(this.identity)
}

module.exports = Tradle
util.inherits(Tradle, EventEmitter)
const proto = Tradle.prototype

proto.sign = function (object, cb) {
  protocol.merkleAndSign({
    object: object,
    sender: this._senderOpts
  }, cb)
}

proto.getRecipientPubKey = function (recipientLink, cb) {
  this.addressBook.lookupIdentity({
    [ROOT_HASH]: recipientLink
  }, function (err, identityInfo) {
    if (err) return cb(err)

    const pubKey = utils.messagingPubKey(identityInfo.identity)
    if (!pubKey) cb(new Error('no suitable pubkey found'))
    else cb(null, pubKey)
  })
}

proto.send = function (object, opts, cb) {
  const self = this
  cb = utils.asyncify(cb)

  typeforce({
    recipient: protocol.types.recipient
  }, opts)

  const rPubKey = opts.recipient.pubKey
  let rLink, oLink, mLink, object, msg, msgID

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
      // const oLink = protocol.link(object)
      mLink = protocol.link(msg)
      msgID = utils.getMsgID({
        // TODO: add prev, to make msgID unique
        link: mLink,
        recipient: rLink,
        sender: self._link
      })

      checkSent(msgID, done)
    },
    function put (done) {
      oLink = protocol.link(object)
      saveMessageToKeeper(self.keeper, msg, mLink, object, oLink, done)
    },
    function log (mLink, oLink, done) {
      ixf.db.put(msgID, {
        topic: topics.msg,
        msgID: msgID,
        object: oLink,
        message: mLink,
        recipient: opts.recipient.link,
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
  let msgID, mLink, oLink

  async.waterfall([
    function lookup (done) {
      if (from.identity) {
        done(null, identityInfo)
      } else {
        addressBook.lookupIdentity(from, done)
      }
    },
    function (identityInfo, done) {
      try {
        utils.validateMessage(msg, identityInfo.identity, self.identity)
      } catch (err) {
        return done(err)
      }

      mLink = protocol.link(msg)
      oLink = protocol.link(msg.object)
      msgID = utils.getMsgID({
        sender: getIdentityLink(identityInfo),
        recipient: self._link,
        link: mLink
      })

      // TODO: check exists?
      saveMessageToKeeper(self.keeper, msg, mLink, object, oLink, done)
    },
    function (done) {
      this._ixf.db.put({
        topic: topics.msg,
        msgID: msgID,
        link: link,
        prevLink: prevLink,
        type: object[TYPE],
        basePubKey: toPubKey,
        amount: opts.amount,
        receivestatus: statuses.receive.received
      }, done)
    }
  ], cb)
}

proto.seal = function (opts, cb) {
  typeforce{
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

function saveMessageToKeeper (keeper, msg, mLink, object, oLink, cb) {
  keeper.putMany([
    { key: utils.hex(oLink), value: toBuffer(object) },
    { key: utils.hex(mLink), value: toBuffer(msg) }
  ])
  .nodeify(cb)
}
