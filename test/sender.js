'use strict'

const test = require('tape')
const extend = require('xtend')
const constants = require('../lib/constants')
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createObjectDB = require('../lib/objectDB')
const createSender = require('../lib/sender')
const utils = require('../lib/utils')
const helpers = require('./helpers')

test('try again', function (t) {
  t.plan(5)

  // const msgs = [
  //   a: { hello: 'world' },
  //   b: { hello: 'alice' }
  // ]

  const keyToVal = {
    a1: {
      // recipientPubKey:
      a: 1
    },
    b1: { b: 1 }
  }

  const keeper = helpers.nextDB()
  const batch = utils.mapToBatch(keyToVal)
  keeper.batch(batch, start)

  const alice = 'alice'
  const bob = 'bob'

  const changes = helpers.nextFeed()

  const objectDB = createObjectDB({
    changes: changes,
    keeper: keeper,
    db: helpers.nextDB()
  })

  changes.append({
    topic: topics.newobj,
    author: bob,
    type: MESSAGE_TYPE,
    permalink: 'a1',
    link: 'a1'
  })

  changes.append({
    topic: topics.newobj,
    author: bob,
    type: MESSAGE_TYPE,
    permalink: 'b1',
    link: 'b1'
  })

  let failedOnce
  const unsent = batch.map(row => row.value)
  const sender = createSender({
    send: function (msg, recipient, cb) {
      t.same(JSON.parse(msg), unsent[0])
      if (failedOnce) {
        unsent.shift()
        return cb()
      }

      failedOnce = true
      cb(new Error('no one was home'))
    },
    keeper: keeper,
    addressBook: {
      // fake address book that does nothing
      lookupIdentity: function (identifier, cb) {
        cb(null, {})
      }
    },
    objectDB: objectDB,
    changes: changes
  })

  objectDB.on('sent', function (wrapper) {
    objectDB.byUID(wrapper.uid, function (err, wrapper) {
      if (err) throw err

      t.equal(wrapper.sendstatus, statuses.send.sent)
    })
  })

  function start (err) {
    if (err) throw err

    sender.start()
  }
})
