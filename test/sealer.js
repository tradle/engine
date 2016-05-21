'use strict'

const test = require('tape')
const extend = require('xtend')
const protocol = require('@tradle/protocol')
const constants = require('../lib/constants')
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const TYPE = constants.TYPE
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createObjectDB = require('../lib/objectDB')
const createSealer = require('../lib/sealer')
const utils = require('../lib/utils')
const Actions = require('../lib/actions')
const helpers = require('./helpers')

test('seal', function (t) {
  t.plan(2)

  // const keyToVal = {
  //   a1: {
  //     // recipientPubKey:
  //     [TYPE]: MESSAGE_TYPE,
  //     a: 1
  //   },
  //   b1: {
  //     [TYPE]: 'something else',
  //     b: 1
  //   },
  //   c1: {
  //     [TYPE]: MESSAGE_TYPE,
  //     c: 1
  //   }
  // }

  const keeper = helpers.nextDB()
  // const batch = utils.mapToBatch(keyToVal)
  // keeper.batch(batch, start)

  const alice = 'alice'
  const authorLink = 'bob'
  const bob = helpers.dummyIdentity(authorLink)

  const changes = helpers.nextFeed()
  const actions = Actions({ changes: changes })

  const objectDB = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB(),
    me: bob
  })

  const basePubKey = protocol.genECKey()
  const sealPubKey = protocol.genECKey()
  const sealPrevPubKey = protocol.genECKey()
  const permalink = 'a1'
  const link = permalink
  const networkName = 'testnet'
  const amount = 20000
  const wrapper = {
    basePubKey,
    sealPubKey,
    sealPrevPubKey,
    link,
    networkName,
    amount
  }

  actions.createSeal(wrapper)

  let failedOnce
  // const unsealed = batch.map(row => row.value).filter(val => val[TYPE] === MESSAGE_TYPE)
  const sealer = createSealer({
    transactor: {
      send: function (to, cb) {
        t.same(to, {
          to: [
            {
              amount,
              address: utils.pubKeyToAddress(sealPubKey, networkName)
            },
            {
              amount,
              address: utils.pubKeyToAddress(sealPrevPubKey, networkName)
            }
          ]
        })

        cb(null, {
          txId: 'blah',
          txHex: 'blahblah'
        })
      }
    },
    objectDB: objectDB,
    actions: actions
  })

  objectDB.on('wroteseal', function (wrapper) {
    objectDB.byUID(utils.sealUID(wrapper), function (err, wrapper) {
      if (err) throw err

      t.equal(wrapper.sealstatus, statuses.seal.sealed)
    })
  })

  start()

  function start (err) {
    if (err) throw err

    sealer.start()
  }
})
