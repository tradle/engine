'use strict'

const test = require('tape')
const extend = require('xtend')
const protocol = require('@tradle/protocol')
const constants = require('../lib/constants')
const SIG = constants.SIG
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const TYPE = constants.TYPE
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createSealDB = require('../lib/dbs/seals')
const createObjectDB = require('../lib/dbs/objects')
const createSealer = require('../lib/sealer')
const utils = require('../lib/utils')
const Actions = require('../lib/actions')
const helpers = require('./helpers')

test('seal', function (t) {
  t.plan(4)

  const permalink = 'a1'
  const link = permalink
  const keyToVal = {
    [link]: {
      [TYPE]: 'something',
      [SIG]: 'blah',
      prop: 'val'
    }
  }

  const keeper = helpers.nextDB()
  const batch = utils.mapToBatch(keyToVal)
  keeper.batch(batch)

  const alice = 'alice'
  const authorLink = 'bob'
  const bob = helpers.dummyIdentity(authorLink)

  const changes = helpers.nextFeed()
  const actions = Actions({ changes: changes })

  const sealDB = createSealDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB(),
    me: bob
  })

  const objectDB = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB(),
    me: bob
  })

  const basePubKey = protocol.genECKey()
  const sealPubKey = protocol.genECKey()
  const sealPrevPubKey = protocol.genECKey()
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

  actions.createObject({
    object: keyToVal[link],
    author: authorLink,
    permalink: link,
    link: link
  })

  actions.writeSeal(wrapper)

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
    seals: sealDB,
    actions: actions
  })

  sealDB.on('wroteseal', function (seal) {
    sealDB.get(seal.uid, function (err, wrapper) {
      if (err) throw err

      t.equal(wrapper.status, statuses.seal.sealed)
    })
  })

  objectDB.on('wroteseal', function (wrapper) {
    t.equal(wrapper.link, link)
    t.equal(wrapper.sealstatus, statuses.seal.sealed)
  })

  sealer.start()
})
