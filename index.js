
const EventEmitter = require('events').EventEmitter
const path = require('path')
const extend = require('xtend')
const typeforce = require('typeforce')
const trackchain = require('chain-tracker')
const Blockchain = require('cb-blockr')
const parallel = require('run-parallel')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const indexFeeds = require('./lib/index-feed')
const utils = require('./lib/utils')
const watchseals = require('./lib/sealwatch')
const sealers = require('./lib/sealer')
const topics = require('./lib/topics')
const createLiveQueue = require('./lib/queue')
const statuses = require('./lib/status')
const types = require('./lib/types')

module.exports = function (opts) {
  assert(typeof opts.networkName === 'string', 'expected "networkName"')
  assert(typeof opts.dir === 'string', 'expected "dir"')
  assert(typeof opts.blockchain === 'object', 'expected "blockchain"')
  assert(typeof opts.identity === 'object', 'expected "identity"')
  assert(typeof opts.keeper === 'object', 'expected keeper "keeper"')
  assert(Array.isArray(opts.keys), 'expected array "keys"')

  const dir = opts.dir
  const ixf = indexFeeds({
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

  const networkName = opts.networkName
  const blockchain = new Blockchain(networkName)
  const keeper = opts.keeper
  const identity = opts.identity
  const keys = opts.keys
  let chainPubKey = utils.find(identity.pubkeys, function (key) {
    return key.type === 'bitcoin' && key.purpose === 'messaging'
  }).value

  chainPubKey = new Buffer(chainPubKey, 'hex')

  const sigKey = utils.find(keys, function (key) {
    return key.type() === 'ec' && key.get('purpose') === 'sign'
  })

  const sigPubKey = mew Buffer(sigKey.pubKeyString(), 'hex')
  const senderOpts = {
    sigPubKey: sigPubKey
    sign: sigKey.sign.bind(sigKey)
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

  sealwatch.on('seal', function (seal) {
    ee.emit('seal', seal)
  })

  const sealer = sealers({
    ixf: ixf,
    transactor: opts.transactor
  })

  const sender = senders({
    ixf: ixf,
    ee: this,
    send: function () {
      return ee._send.apply(ee, arguments)
    }
  })

  ;[sealer, sealwatch, sender].forEach(function (component) {
    component.on('error', function (err) {
      ee.emit('error', err)
    })
  })

  const ee = new EventEmitter()

  ee.sign = function (object, cb) {
    return protocol.merkleAndSign({
      object: object,
      sender: senderOpts
    }, cb)
  }

  ee.send = function (object, opts, cb) {
    cb = utils.asyncify(cb)
    protocol.share({
      object: object,
      recipient: opts.recipient,
      sender: senderOpts
    }, function (err, sendInfo) {
      if (err) return cb(err)

      const object = opts.object
      const share = opts.share
      parallel([object, share].map(function (object) {
        return send.bind(null, {
          object: object,
          recipient: opts.recipient
        })
      }), cb)
    })
  }

  ee.receive = function (msg, from, cb) {
    typeforce(types.identityInfo, from)

    cb = utils.asyncify(cb)
    verifier.verifyMessage(msg, from, function (err) {
      if (err) return cb(err)


    })
  }

  ee.seal = function (opts, cb) {
    assert(typeof opts.amount === 'number', 'expected number "amount"')
    assert(typeof opts.object === 'object', 'expected object "object"')

    const object = opts.object
    const link = protocol.link(object)
    const prevLink = protocol.prevLink(object)
    const toPubKey = opts.pubKey || chainPubKey
    const sealID = utils.getSealID({
      link: link,
      toPubKey: toPubKey
    })

    getSeal(sealID, function (err, seal) {
      if (seal) return cb()

      keeper.putMany(oLink, object)
      .then(function () {
        ixf.db.put(sealID, {
          topic: topics.seal,
          sealID: sealID,
          link: link,
          prevLink: prevLink,
          type: object[TYPE],
          pubKey: toPubKey,
          amount: opts.amount,
          sealstatus: statuses.seal.unsealed
        }, cb)
      }, cb)
    })
  }

  ee.watch = function (addr, link, cb) {
    const watchID = utils.getWatchID({
      address: addr,
      link: link
    })

    getWatch(watchID, function (err, val) {
      if (val) return cb()

      ixf.db.put(watchID, {
        topic: topics.watch,
        watchID: watchID,
        address: addr,
        link: link,
        watchstatus: statuses.watch.unseen
      }, cb)
    })
  }

  ee._send = function () {
    throw new Error('implement this one yourself')
  }

  ee.destroy = function () {
    sealwatch.stop()
    sealer.stop()
    sender.stop()
  }

  sealer.start()
  sender.start()
  sealwatch.start()

  return ee

  function send (opts, cb) {
    const object = opts.object
    const oLink = protocol.link(object)
    const rLink = opts.recipient.link
    const msgID = utils.getMsgID({
      link: oLink,
      recipientLink: rLink
    })

    getSent(msgID, function (err, val) {
      if (val) return cb()

      keeper.put(oLink, object)
        .then(function () {
          ixf.db.put(msgID, {
            topic: topics.msg,
            msgID: msgID,
            object: oLink,
            type: object[TYPE],
            sendstatus: statuses.send.unsent
          }, cb)
        }, cb)
    })
  }
}

function getWatch (watchID, cb) {
  ixf.index.firstWithValue('watchID', watchID, cb)
}

function getSeal (sealID, cb) {
  ixf.index.firstWithValue('sealID', sealID, cb)
}

function getMsg (msgID, cb) {
  ixf.index.firstWithValue('msgID', msgID, cb)
}
