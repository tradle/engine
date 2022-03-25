require('./env')

const test = require('tape')
const leveldown = require('memdown')
const collect = require('stream-collector')
const Cache = require('lru-cache')
const protocol = require('@tradle/protocol')
const createAddressBook = require('../lib/dbs/addressBook')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const constants = require('../lib/constants')
const createActions = require('../lib/actions')
const {
  SIG,
  AUTHOR,
} = constants

const helpers = require('./helpers')

test('update identity (no caching)', newUpdateTest())
test('update identity (caching)', newUpdateTest(true))

function newUpdateTest (doCache) {
  return function (t) {
    const changes = helpers.nextFeed()
    const ted = utils.clone(users[0].identity)
    const originalHash = protocol.linkString(ted)

    const newTed = protocol.nextVersion(ted)
    newTed.name = 'ted!'
    newTed[SIG] = 'newsig'
    newTed[AUTHOR] = originalHash

    const updateHash = protocol.linkString(newTed)
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
