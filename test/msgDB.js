'use strict'

const test = require('tape')
const async = require('async')
const extend = require('xtend')
const leveldown = require('memdown')
const collect = require('stream-collector')
const constants = require('@tradle/constants')
const fakeKeeper = require('@tradle/test-helpers').fakeKeeper
const createMessageDB = require('../lib/msgDB')
const users = require('./fixtures/users')
const utils = require('../lib/utils')
const logs = require('../lib/logs')
const topics = require('../lib/topics')
const TYPE = constants.TYPE
const ROOT_HASH = constants.ROOT_HASH
const PREV_HASH = constants.PREV_HASH
const CUR_HASH = constants.CUR_HASH
const IDENTITY_TYPE = constants.TYPES.IDENTITY
let dbCounter = 0
const nextDBName = function () {
  return 'db' + (dbCounter++)
}

test('send / receive', function (t) {
  const keeperMap = {
    a1: { a: 1 },
    a2: { a: 2 },
    b1: { b: 1 }
  }

  const alice = createMessageDB({
    leveldown: leveldown,
    log: logs(nextDBName(), {
      db: leveldown
    }),
    keeper: fakeKeeper.forMap(keeperMap),
    db: nextDBName()
  })

  async.series([
    function (cb) {
      alice._db.put('a', {
        topic: topics.msg,
        msgID: 'a',
        type: 'fruit',
        [ROOT_HASH]: 'a1',
        [CUR_HASH]: 'a1'
      }, cb)
    },
    function (cb) {
      alice._db.put('b', {
        topic: topics.msg,
        msgID: 'b',
        type: 'veggie',
        [ROOT_HASH]: 'b1',
        [CUR_HASH]: 'b1'
      }, cb)
    },
    function (cb) {
      alice._db.put('a', {
        topic: topics.msg,
        [ROOT_HASH]: 'a1',
        [CUR_HASH]: 'a2'
      }, cb)
    }
  ], function (err) {
    if (err) throw err

    alice.list(function (err, msgs) {
      if (err) throw err

      t.same(msgs, [ { a: 2 }, { b: 1 } ])
      alice.list('fruit', function (err, msgs) {
        if (err) throw err

        t.same(msgs, [ { a: 2 }])
        t.end()
      })
    })
  })
})
