'use strict'

const test = require('tape')
const async = require('async')
const extend = require('xtend')
const leveldown = require('memdown')
const collect = require('stream-collector')
const levelup = require('levelup')
const changesFeed = require('changes-feed')
const constants = require('./constants')
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

test('list messages', function (t) {
  const keeper = helpers.keeper()
  keeper.batch([
    {
      type: 'put',
      key: 'a1',
      value: { a: 1 }
    },
    {
      type: 'put',
      key: 'b1',
      value: { b: 1 }
    },
    {
      type: 'put',
      key: 'a2',
      value: { a: 2 }
    }
  ], start)


  const changes = helpers.nextFeed()
  const alice = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB()
  })

  changes.append({
    topic: topics.msg,
    msgID: 'a',
    type: 'fruit',
    [PERMALINK]: 'a1',
    [LINK]: 'a1'
  })

  changes.append({
    topic: topics.msg,
    msgID: 'b',
    type: 'veggie',
    [PERMALINK]: 'b1',
    [LINK]: 'b1'
  })

  changes.append({
    topic: topics.msg,
    msgID: 'a',
    [PERMALINK]: 'a1',
    [LINK]: 'a2'
  })

  function start (err) {
    if (err) throw err

    alice.list(function (err, msgs) {
      if (err) throw err

      t.same(msgs.map(m => m.object), [ { a: 2 }, { b: 1 } ])
      alice.list('fruit', function (err, msgs) {
        if (err) throw err

        t.same(msgs.map(m => m.object), [ { a: 2 }])
        t.end()
      })
    })
  }
})

// test.only('end to end', function (t) {
//   const tradles = users.slice(0, 3).map(createNode)
// })
