'use strict'

const test = require('tape')
const async = require('async')
const extend = require('xtend')
const leveldown = require('memdown')
const collect = require('stream-collector')
const levelup = require('levelup')
const changesFeed = require('../lib/changes')
const constants = require('../lib/constants')
const createObjectDB = require('../lib/objectDB')
const createSender = require('../lib/sender')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const TYPE = constants.TYPE
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const helpers = require('./helpers')

test('list objects', function (t) {
  const keeper = helpers.keeper()
  const keyValMap = {
    a1: { a: 1 },
    b1: { b: 1 },
    a2: { a: 2 }
  }

  keeper.batch(utils.mapToBatch(keyValMap), start)

  const changes = helpers.nextFeed()
  const alice = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB()
  })

  changes.append({
    topic: topics.newobj,
    author: 'alice',
    type: 'fruit',
    permalink: 'a1',
    link: 'a1'
  })

  changes.append({
    topic: topics.newobj,
    author: 'alice',
    type: 'veggie',
    permalink: 'b1',
    link: 'b1'
  })

  changes.append({
    topic: topics.newobj,
    author: 'alice',
    permalink: 'a1',
    prevlink: 'a1',
    type: 'fruit',
    link: 'a2'
  })

  function start (err) {
    if (err) throw err

    alice.list(function (err, msgs) {
      if (err) throw err

      t.same(msgs.map(m => m.object), [ { a: 2 }, { b: 1 } ])
      alice.list('fruit', function (err, msgs) {
        if (err) throw err

        t.same(msgs.map(m => m.object), [ { a: 2 }])

        alice.byPermalink('a1', function (err, wrapper) {
          if (err) throw err

          t.equal(wrapper.link, 'a2')
          t.end()
        })
      })
    })
  }
})
