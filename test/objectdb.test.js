require('./env')

const test = require('tape')
const collect = require('stream-collector')
const protocol = require('@tradle/protocol')
const Actions = require('../lib/actions')
const constants = require('../lib/constants')
const createObjectDB = require('../lib/dbs/objects')
const utils = require('../lib/utils')
const {
  TYPE,
  SIG,
  AUTHOR,
} = constants

const helpers = require('./helpers')

test('list objects', function (t) {
  const keeper = helpers.keeper()
  const keyValMap = {
    a1: { a: 1, [TYPE]: 'fruit', [AUTHOR]: 'ted' },
    b1: { b: 1, [TYPE]: 'fruit', [AUTHOR]: 'ted' },
    a2: { a: 1, [TYPE]: 'fruit', [AUTHOR]: 'ted', healthy: 'yes' },
    c1: { c: 1, [TYPE]: 'veggie', [AUTHOR]: 'ted', healthy: 'yes' }
  }

  for (let key in keyValMap) {
    keyValMap[key] = protocol.object({ object: keyValMap[key] })
    keyValMap[key][SIG] = 'bs'
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
