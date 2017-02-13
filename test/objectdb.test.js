const test = require('tape')
const async = require('async')
const extend = require('xtend')
const leveldown = require('memdown')
const collect = require('stream-collector')
const Actions = require('../lib/actions')
const constants = require('../lib/constants')
const createObjectDB = require('../lib/dbs/objects')
const createSender = require('../lib/sender')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const TYPE = constants.TYPE
const SIG = constants.SIG
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const helpers = require('./helpers')

test('list objects', function (t) {
  const keeper = helpers.keeper()
  const keyValMap = {
    a1: { a: 1, [TYPE]: 'fruit', [SIG]: 'bs' },
    b1: { b: 1, [TYPE]: 'fruit', [SIG]: 'bs' },
    a2: { a: 1, [TYPE]: 'fruit', [SIG]: 'bs', healthy: 'yes' },
    c1: { c: 1, [TYPE]: 'veggie', [SIG]: 'bs', healthy: 'yes' }
  }

  keeper.batch(utils.mapToBatch(keyValMap), start)

  const changes = helpers.nextFeed()
  const actions = Actions({ changes })
  const authorLink = 'alice'
  const alice = helpers.dummyIdentity(authorLink)

  const objDB = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB(),
    identityInfo: alice
  })

  actions.createObject({
    object: keyValMap.a1,
    author: authorLink,
    permalink: 'a1',
    link: 'a1'
  })

  actions.createObject({
    object: keyValMap.b1,
    author: authorLink,
    permalink: 'b1',
    link: 'b1'
  })

  actions.createObject({
    object: keyValMap.a2,
    author: authorLink,
    permalink: 'a1',
    prevLink: 'a1',
    link: 'a2'
  })

  actions.createObject({
    object: keyValMap.c1,
    author: authorLink,
    permalink: 'c1',
    prevLink: 'c1',
    link: 'c1'
  })

  function start (err) {
    if (err) throw err

    objDB.list(function (err, msgs) {
      if (err) throw err

      t.same(msgs.map(m => m.object), [ keyValMap.a2, keyValMap.b1, keyValMap.c1 ])
      collect(objDB.type('fruit'), function (err, msgs) {
        if (err) throw err

        t.same(msgs.map(m => m.object), [ keyValMap.a2, keyValMap.b1 ])

        objDB.byPermalink('a1', function (err, wrapper) {
          if (err) throw err

          t.equal(wrapper.link, 'a2')
          t.end()
        })
      })
    })
  }
})
