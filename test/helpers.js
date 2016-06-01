'use strict'

const crypto = require('crypto')
const extend = require('xtend')
const leveldown = require('memdown')
const changesFeed = require('changes-feed')
const async = require('async')
const fakeWallet = require('@tradle/test-helpers').fakeWallet
const Wallet = require('@tradle/simple-wallet')
const kiki = require('@tradle/kiki')
const utils = require('../lib/utils')
const constants = require('../lib/constants')
const Node = require('../lib/node')
const names = ['alice', 'bob', 'carol', 'david', 'eve', 'falstaff', 'ganondorf']
const TYPE = constants.TYPE
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const DEFAULT_NETWORK_NAME = 'testnet'
const helpers = exports
let dbCounter = 0
let INSTANCE_COUNT = 0

exports.names = names
exports.nextDBName = function nextDBName () {
  return 'db' + (dbCounter++)
}

exports.nextFeed = function nextFeed () {
  return changesFeed(helpers.nextDB())
}

exports.nextDB = function nextDB (opts) {
  opts = opts || {}
  if (!opts.leveldown) opts.db = leveldown
  return utils.levelup(helpers.nextDBName(), opts)
}

exports.keeper = function () {
  var db = helpers.nextDB()
  // var map = {}
  // db._memory = map
  // db.on('batch', function (batch) {
  //   console.log('put batch')
  // })

  // db.on('put', function (key, value) {
  //   map[key] = value
  //   console.log('put row', key)
  // })

  return db
}

exports.dummyIdentity = function (authorLink) {
  return {
    object: {
      [TYPE]: IDENTITY_TYPE,
      pubkeys: []
    },
    link: authorLink,
    permalink: authorLink
  }
}

exports.transactor = function (key, blockchain) {
  const wallet = helpers.wallet(key, blockchain)
  const transactor = Wallet.transactor({ wallet })
  transactor.blockchain = wallet.blockchain
  return transactor
}

exports.wallet = function (key, blockchain) {
  var unspents = []
  for (var i = 0; i < 20; i++) {
    unspents.push(100000)
  }

  return fakeWallet({
    blockchain: blockchain,
    unspents: unspents,
    priv: key
  })
}

exports.connect = function connect (people) {
  helpers.eachOther(people, function receiveOnSend (a, b) {
    var aInfo = { link: a.identityInfo.link }
    a._send = function (msg, recipient, cb) {
      b.receive(msg, aInfo, function (err) {
        if (err) throw err

        cb.apply(null, arguments)
      })
    }
  })
}

exports.meet = function meet (people, cb) {
  helpers.eachOther(people, (a, b, done) => a.addContact(b.identity, done), cb)
}

exports.eachOther = function eachOther (args, fn, cb) {
  async.parallel(args.map(a => {
    return done => {
      args.forEach(b => {
        if (a !== b) {
          fn(a, b, done)
        }
      })
    }
  }), cb || noop)
}

exports.userToOpts = function userToOpts (user, name) {
  return {
    identity: user.pub,
    keys: user.priv.map(key => kiki.toKey(key)),
    name: name
  }
}

exports.createNode = function createNode (opts) {
  const networkName = opts.networkName || DEFAULT_NETWORK_NAME
  const priv = utils.chainKey(opts.keys).exportPrivate().priv
  const transactor = opts.transactor || helpers.transactor(priv, opts.blockchain)
  const blockchain = opts.blockchain || transactor.blockchain
  opts = extend(opts, {
    dir: opts.dir || helpers.nextDir(),
    keeper: helpers.keeper(),
    networkName: networkName,
    transactor: transactor,
    blockchain: blockchain,
    leveldown: opts.leveldown || leveldown,
  })

  return new Node(opts)
}

exports.nextDir = function nextDir () {
  return `./testdir/${INSTANCE_COUNT++}.db`
}

process.on('uncaughtException', function (err) {
  if (err.tfError) console.log(err.tfError.stack)

  throw err
})
