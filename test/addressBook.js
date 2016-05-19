'use strict'

const test = require('tape')
const async = require('async')
const extend = require('xtend')
const levelup = require('levelup')
const leveldown = require('memdown')
const collect = require('stream-collector')
// const tradle = require('../')
const changesFeed = require('../lib/changes')
const createAddressBook = require('../lib/addressBook')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const topics = require('../lib/topics')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const IDENTITY_TYPE = constants.types.IDENTITY
const helpers = require('./helpers')

test('ignore identities that collide on keys', function (t) {
  const ted = extend(users[0].pub) // defensive copy
  const feed = helpers.nextFeed()
  const badPerson = extend(ted, { name: 'evil ted' })
  const tedHash = 'abc'
  const badPersonHash = 'efg'
  const keeper = helpers.nextDB()
  keeper.batch([
    {
      type: 'put',
      key: tedHash,
      value: ted
    },
    {
      type: 'put',
      key: badPersonHash,
      value: badPerson
    }
  ], start)

  // const tedFromChain = new Entry({
  //     type: EventType.chain.readSuccess
  //   })
  //   .set(TYPE, IDENTITY_TYPE)
  //   .set(LINK, tedHash)
  //   .set(PERMALINK, tedHash)

  // const badPersonFromChain = new Entry({
  //     type: EventType.chain.readSuccess
  //   })
  //   .set(TYPE, IDENTITY_TYPE)
  //   .set(LINK, badPersonHash)
  //   .set(PERMALINK, badPersonHash)

  const db = helpers.nextDB()
  const identities = createAddressBook({
    changes: feed,
    keeper: keeper,
    db: db
  })

  feed.append({
    topic: topics.addcontact,
    [PERMALINK]: tedHash,
    [LINK]: tedHash
  })

  feed.append({
    topic: topics.addcontact,
    [PERMALINK]: badPersonHash,
    [LINK]: badPersonHash
  })

  function start (err) {
    if (err) throw err

    identities.lookupIdentity(badPersonHash, function (err) {
      t.ok(err)
    })

    async.parallel(ted.pubkeys.map(key => {
      return function (cb) {
        identities.lookupIdentity(key.fingerprint, function (err, identityInfo) {
          if (err) throw err

          t.same(identityInfo, {
            [PERMALINK]: tedHash,
            [LINK]: tedHash,
            identity: ted
          })

          cb()
        })
      }
    }), t.end)
  }
})

test('update identity', function (t) {
  const changes = helpers.nextFeed()


  const originalHash = 'abc'
  const updateHash = 'abc1'

  const ted = extend(users[0].pub)
  const newTed = extend(ted)
  newTed.name = 'ted!'
  newTed[PERMALINK] = originalHash
  newTed[PREVLINK] = originalHash

  const keeper = helpers.nextDB()
  keeper.batch([
    {
      type: 'put',
      key: originalHash,
      value: ted
    },
    {
      type: 'put',
      key: updateHash,
      value: newTed
    }
  ], start)

  const identities = createAddressBook({
    leveldown: leveldown,
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB()
  })

  changes.append({
    topic: topics.addcontact,
    [PERMALINK]: originalHash,
    [LINK]: originalHash
  })

  changes.append({
    topic: topics.addcontact,
    [PERMALINK]: originalHash,
    [PREVLINK]: originalHash,
    [LINK]: updateHash
  })

  function start (err) {
    if (err) throw err

    identities.lookupIdentity(newTed.pubkeys[0].fingerprint, function (err, storedTed) {
      if (err) throw err

      t.same(storedTed.identity, newTed)
      testStreams()
    })
  }

  function testStreams () {
    collect(identities.stream(), function (err, stored) {
      if (err) throw err

      t.equal(stored.length, 1)
      stored = stored[0]
      t.same(stored.identity, newTed)
      t.equal(stored[LINK], updateHash)
      t.equal(stored[PERMALINK], originalHash)
      t.end()
    })
  }
})
