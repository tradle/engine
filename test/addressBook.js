'use strict'

const test = require('tape')
const async = require('async')
const extend = require('xtend')
const levelup = require('levelup')
const leveldown = require('memdown')
const collect = require('stream-collector')
const constants = require('@tradle/constants')
const fakeKeeper = require('@tradle/test-helpers').fakeKeeper
const changesFeed = require('changes-feed')
const createAddressBook = require('../lib/addressBook')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const topics = require('../lib/topics')
const indexFeed = require('../lib/index-feed')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const PREV_HASH = constants.PREV_HASH
const CUR_HASH = constants.CUR_HASH
const IDENTITY_TYPE = constants.TYPES.IDENTITY
let dbCounter = 0
const nextDBName = function () {
  return 'db' + (dbCounter++)
}

const nextFeed = function () {
  return changesFeed(nextDB())
}

const nextDB = function () {
  return levelup(nextDBName(), {
    db: leveldown,
    valueEncoding: 'json'
  })
}

test('ignore identities that collide on keys', function (t) {
  const ted = extend(users[0].pub) // defensive copy
  const feed = nextFeed()
  const badPerson = extend(ted, { name: 'evil ted' })
  const keeperMap = {}
  const tedHash = 'abc'
  const badPersonHash = 'efg'
  keeperMap[tedHash] = ted
  keeperMap[badPersonHash] = badPerson

  // const tedFromChain = new Entry({
  //     type: EventType.chain.readSuccess
  //   })
  //   .set(TYPE, IDENTITY_TYPE)
  //   .set(CUR_HASH, tedHash)
  //   .set(ROOT_HASH, tedHash)

  // const badPersonFromChain = new Entry({
  //     type: EventType.chain.readSuccess
  //   })
  //   .set(TYPE, IDENTITY_TYPE)
  //   .set(CUR_HASH, badPersonHash)
  //   .set(ROOT_HASH, badPersonHash)

  const keeper = fakeKeeper.forMap(keeperMap)

  const db = nextDB()
  const identities = createAddressBook({
    changes: feed,
    keeper: keeper,
    db: db
  })

  feed.append({
    topic: topics.addcontact,
    [ROOT_HASH]: tedHash,
    [CUR_HASH]: tedHash
  })

  feed.append({
    topic: topics.addcontact,
    [ROOT_HASH]: badPersonHash,
    [CUR_HASH]: badPersonHash
  })

  identities.lookupIdentity(badPersonHash, function (err) {
    t.ok(err)
  })

  async.parallel(ted.pubkeys.map(key => {
    return function (cb) {
      identities.lookupIdentity(key.fingerprint, function (err, identityInfo) {
        if (err) throw err

        t.same(identityInfo, {
          [ROOT_HASH]: tedHash,
          [CUR_HASH]: tedHash,
          identity: ted
        })

        cb()
      })
    }
  }), t.end)
})

test('update identity', function (t) {
  const changes = nextFeed()

  let ted = extend(users[0].pub)

  var keeperMap = {}
  var originalHash = 'abc'

  keeperMap[originalHash] = ted

  ted = extend(ted)
  ted.name = 'ted!'
  ted[ROOT_HASH] = originalHash
  ted[PREV_HASH] = originalHash

  var updateHash = 'abc1'
  keeperMap[updateHash] = ted
  const keeper = fakeKeeper.forMap(keeperMap)
  const identities = createAddressBook({
    leveldown: leveldown,
    changes: changes,
    keeper: keeper,
    db: nextDB()
  })

  changes.append({
    topic: topics.addcontact,
    [ROOT_HASH]: originalHash,
    [CUR_HASH]: originalHash
  })

  changes.append({
    topic: topics.addcontact,
    [ROOT_HASH]: originalHash,
    [PREV_HASH]: originalHash,
    [CUR_HASH]: updateHash
  })

  identities.lookupIdentity(ted.pubkeys[0].fingerprint, function (err, storedTed) {
    if (err) throw err

    t.same(storedTed.identity, ted)
    testStreams()
  })

  function testStreams () {
    collect(identities.stream(), function (err, stored) {
      if (err) throw err

      t.equal(stored.length, 1)
      stored = stored[0]
      t.same(stored.identity, ted)
      t.equal(stored[CUR_HASH], updateHash)
      t.equal(stored[ROOT_HASH], originalHash)
      t.end()
    })
  }
})
