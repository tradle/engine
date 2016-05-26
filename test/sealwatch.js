'use strict'

const test = require('tape')
const extend = require('xtend')
const protocol = require('@tradle/protocol')
const createChainTracker = require('chain-tracker')
const bitcoin = require('@tradle/bitcoinjs-lib')
const constants = require('../lib/constants')
const watchTypes = constants.watchType
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const TYPE = constants.TYPE
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const SIG = constants.SIG
const createSealWatch = require('../lib/sealwatch')
const createWatchDB = require('../lib/dbs/watches')
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createSealer = require('../lib/sealer')
const utils = require('../lib/utils')
const Actions = require('../lib/actions')
const helpers = require('./helpers')

test('watch', function (t) {
  t.plan(3)

  const obj = {
    [TYPE]: 'something',
    prop: 'val'
  }

  // protocol.sign({ object: obj, }, function (err, obj) {

  // })

  const permalink = 'a1'
  const link = permalink
  const keyToVal = {
    [link]: obj
  }

  const keeper = helpers.nextDB()
  const batch = utils.mapToBatch(keyToVal)
  keeper.batch(batch)

  const alice = 'alice'
  const authorLink = 'bob'
  const bob = helpers.dummyIdentity(authorLink)
  const bobKey = protocol.genECKey()
  const networkName = 'testnet'
  const bobKeyWIF = utils.privToWIF(bobKey.priv, networkName)

  const changes = helpers.nextFeed()
  const actions = Actions({ changes: changes })

  const transactor = helpers.transactor(bobKeyWIF)
  const chaintracker =  createChainTracker({
    db: helpers.nextDB({ valueEncoding: 'json' }),
    blockchain: transactor.blockchain,
    networkName: networkName,
    confirmedAfter: 10 // stop tracking a tx after 10 blocks
  })

  const watchDB = createWatchDB({
    changes: changes,
    db: helpers.nextDB(),
    keeper: keeper
  })

  const sealwatch = createSealWatch({
    actions: actions,
    chaintracker: chaintracker,
    db: helpers.nextDB(),
    watches: watchDB,
    syncInterval: 200
  })

  sealwatch.on('error', function (err) {
    throw err
  })

  sealwatch.start()

  const basePubKey = protocol.genECKey()
  const sealPubKey = protocol.genECKey()

  const address = utils.pubKeyToAddress(sealPubKey, networkName)
  actions.createWatch({
    link: link,
    address: address,
    basePubKey: basePubKey,
    watchType: watchTypes.thisVersion
  })

  // const sealPrevPubKey = protocol.genECKey()
  transactor.send({
    to: [
      {
        address: address,
        amount: 10000
      }
    ]
  }, function (err) {
    if (err) throw err
  })

  const createdActions = {}

  actions.on('newwatch', checkAction)
  actions.on('readseal', checkAction)

  // give time for duplicates to arrive if there are any
  setTimeout(function () {
    sealwatch.stop()
    t.pass()
    t.end()
  }, 1000)

  function checkAction (action) {
    t.notOk(createdActions[action.topic])
  }
})
