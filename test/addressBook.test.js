const test = require('tape')
const async = require('async')
const extend = require('xtend')
const levelup = require('levelup')
const leveldown = require('memdown')
const collect = require('stream-collector')
// const tradle = require('../')
const changesFeed = require('changes-feed')
const Cache = require('lru-cache')
const createAddressBook = require('../lib/dbs/addressBook')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const topics = require('../lib/topics')
const constants = require('../lib/constants')
const createActions = require('../lib/actions')
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const helpers = require('./helpers')

// test('ignore identities that collide on keys', function (t) {
//   const ted = extend(users[0].pub) // defensive copy
//   const changes = helpers.nextFeed()
//   const badPerson = extend(ted, { name: 'evil ted' })
//   const tedHash = 'abc'
//   const badPersonHash = 'efg'
//   const keeper = helpers.keeper()
//   const keyValMap = {
//     [tedHash]: ted,
//     [badPersonHash]: badPerson
//   }

//   keeper.batch(utils.mapToBatch(keyValMap), start)

//   // const tedFromChain = new Entry({
//   //     type: EventType.chain.readSuccess
//   //   })
//   //   .set(TYPE, IDENTITY_TYPE)
//   //   .set(LINK, tedHash)
//   //   .set(PERMALINK, tedHash)

//   // const badPersonFromChain = new Entry({
//   //     type: EventType.chain.readSuccess
//   //   })
//   //   .set(TYPE, IDENTITY_TYPE)
//   //   .set(LINK, badPersonHash)
//   //   .set(PERMALINK, badPersonHash)

//   const db = helpers.nextDB()
//   const identities = createAddressBook({
//     changes: changes,
//     keeper: keeper,
//     db: db
//   })

//   const actions = createActions({ changes })

//   actions.addContact(ted, tedHash)
//   actions.addContact(badPerson, badPersonHash)

//   function start (err) {
//     if (err) throw err

//     identities.lookupIdentity(badPersonHash, function (err) {
//       t.ok(err)
//     })

//     async.parallel(ted.pubkeys.map(key => {
//       return function (cb) {
//         identities.lookupIdentity(key.fingerprint, function (err, identityInfo) {
//           if (err) throw err

//           delete identityInfo.timestamp
//           t.same(identityInfo, {
//             permalink: tedHash,
//             link: tedHash,
//             prevLink: null,
//             object: ted
//           })

//           cb()
//         })
//       }
//     }), t.end)
//   }
// })

test('update identity (no caching)', newUpdateTest())
test('update identity (caching)', newUpdateTest(true))

function newUpdateTest (doCache) {
  return function (t) {
    const changes = helpers.nextFeed()
    const originalHash = 'abc'
    const updateHash = 'abc1'

    const ted = extend(users[0].identity)
    const newTed = extend(ted)
    newTed[PREVLINK] = newTed[PERMALINK] = originalHash
    newTed.name = 'ted!'

    const keeper = helpers.keeper()
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
      db: helpers.nextDB(),
      identityInfo: {
        object: ted,
        link: originalHash,
        permalink: originalHash
      }
    })

    if (doCache) {
      identities.setCache(new Cache({
        max: Infinity
      }))
    }

    const actions = createActions({ changes })
    actions.addContact(ted, originalHash)
    actions.addContact(newTed, updateHash)

    function start (err) {
      if (err) throw err

      identities.lookupIdentity(newTed.pubkeys[0].fingerprint, function (err, storedTed) {
        if (err) throw err

        t.same(storedTed.object, newTed)
        if (doCache) {
          var cached = identities.getCache().get('link' + updateHash)
          t.same(cached.object, newTed)
          t.equals(cached.link, updateHash)
          t.equals(cached.permalink, originalHash)
        }

        testStreams()
      })
    }

    function testStreams () {
      collect(identities.createReadStream(), function (err, stored) {
        if (err) throw err

        t.equal(stored.length, 1)
        stored = stored[0]
        t.same(stored.object, newTed)
        t.equal(stored.link, updateHash)
        t.equal(stored.permalink, originalHash)
        t.end()
      })
    }
  }
}
