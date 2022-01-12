require('./env')

const test = require('tape')
const async = require('async')
const protocol = require('@tradle/protocol')
// const network = require('@tradle/bitcoin-adapter').testnet
// const createChainTracker = require('chain-tracker')
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
const { network, blocktime } = helpers
const users = require('./fixtures/users')

test('watch', function (t) {
  t.plan(2)

  const obj = {
    [TYPE]: 'something',
    prop: 'val'
  }

  // protocol.sign({ object: obj, }, function (err, obj) {

  // })

  const permalink = 'a1'
  const link = permalink
  const headerHash = 'b1'
  const keyToVal = {
    [link]: obj
  }

  const keeper = helpers.nextDB()
  const batch = utils.mapToBatch(keyToVal)
  keeper.batch(batch)

  const alice = 'alice'
  const authorLink = 'bob'
  // const networkName = 'testnet'
  const changes = helpers.nextFeed()
  const actions = Actions({ changes })

  // const bob = helpers.dummyIdentity(authorLink)
  // const bobKey = protocol.genECKey()
  const bob = users[0]
  const transactor = helpers.transactor({ keys: bob.keys })

  const watchDB = createWatchDB({
    changes,
    db: helpers.nextDB(),
    keeper: keeper
  })

  const sealwatch = createSealWatch({
    actions,
    // chaintracker: chaintracker,
    getBlockchainAdapter: () => network,
    db: helpers.nextDB(),
    watches: watchDB,
    objects: {}, // don't actually need it yet
    syncInterval: 200,
    confirmedAfter: 10
  })

  sealwatch.on('error', rethrow)
  sealwatch.start()

  const basePubKey = protocol.genECKey()
  const sealPubKey = protocol.genECKey()

  const address = network.pubKeyToAddress(sealPubKey.pub)
  actions.createWatch({
    blockchain: network.blockchain,
    networkName: network.name,
    link,
    address,
    headerHash,
    basePubKey,
    watchType: watchTypes.thisVersion
  })

  // const sealPrevPubKey = protocol.genECKey()
  transactor.send({
    to: [
      {
        address,
        amount: 10000
      }
    ]
  }, rethrow)

  const createdActions = {}

  actions.on('newwatch', recordAction)
  actions.on('readseal', recordAction)

  // give time for duplicates to arrive if there are any
  setTimeout(function () {
    t.deepEquals(createdActions, {
      newwatch: true,
      readseal: true
    })

    sealwatch.stop()
    if (network.api.close) network.api.close()
    if (transactor.close) transactor.close()

    t.pass()
    t.end()
  }, blocktime * 4)

  function recordAction (action) {
    createdActions[action.topic] = true
  }
})

test('batch', function (t) {
  t.timeoutAfter(100000)

  const numTxs = 40
  const keyToVal = {}
  new Array(numTxs).fill(0).forEach((o, i) => {
    keyToVal['blah' + i] = {
      [TYPE]: 'something',
      prop: 'val',
      count: i
    }
  })

  // protocol.sign({ object: obj, }, function (err, obj) {

  // })

  const keeper = helpers.nextDB()
  const batch = utils.mapToBatch(keyToVal)
  keeper.batch(batch)

  const alice = 'alice'
  const authorLink = 'bob'
  const bob = users[0]
  // const bob = helpers.dummyIdentity(authorLink)
  // const bobKey = protocol.genECKey()
  const changes = helpers.nextFeed()
  const actions = Actions({ changes })

  const transactor = helpers.transactor(bob)
  const watchDB = createWatchDB({
    changes,
    db: helpers.nextDB(),
    keeper: keeper
  })

  const sealwatch = createSealWatch({
    actions,
    // chaintracker: chaintracker,
    getBlockchainAdapter: () => network,
    db: helpers.nextDB(),
    watches: watchDB,
    objects: {}, // don't actually need it yet
    batchSize: 5,
    syncInterval: 2000,
    interBatchTimeout: 100,
    confirmedAfter: 10
  })

  sealwatch.on('error', rethrow)
  sealwatch.start()

  const { api } = network
  const txs = api.addresses.transactions
  let total = 0
  api.addresses.transactions = function (txs, cb) {
    t.ok(txs.length <= 5)
    total += txs.length
    cb(null, [])
    if (total === numTxs) {
      sealwatch.stop()
      if (api.close) api.close()
      if (transactor.close) transactor.close()

      t.end()
    }
  }

  async.forEach(Object.keys(keyToVal), function (link, done) {
    const basePubKey = protocol.genECKey()
    const sealPubKey = protocol.genECKey()

    const address = network.pubKeyToAddress(sealPubKey.pub)
    actions.createWatch({
      blockchain: network.blockchain,
      networkName: network.name,
      link,
      address,
      headerHash: 'blahheaderhash',
      basePubKey,
      watchType: watchTypes.thisVersion
    }, rethrow)

    // const sealPrevPubKey = protocol.genECKey()
    transactor.send({
      to: [
        {
          address: address,
          amount: 10000
        }
      ]
    }, done)
  }, rethrow)
})

function rethrow (err) {
  if (err) throw err
}
