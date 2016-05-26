
const crypto = require('crypto')
const extend = require('xtend')
const leveldown = require('memdown')
const changesFeed = require('changes-feed')
const fakeWallet = require('@tradle/test-helpers').fakeWallet
const Wallet = require('@tradle/simple-wallet')
const utils = require('../lib/utils')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const helpers = exports
var dbCounter = 0

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

process.on('uncaughtException', function (err) {
  if (err.tfError) console.log(err.tfError.stack)

  throw err
})
