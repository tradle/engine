'use strict'

const test = require('tape')
const extend = require('xtend')
const constants = require('../lib/constants')
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const LINK = constants.LINK
const TYPE = constants.TYPE
const SIG = constants.SIG
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const topics = require('../lib/topics')
const statuses = require('../lib/status')
const createObjectDB = require('../lib/dbs/objects')
const createSender = require('../lib/sender')
const utils = require('../lib/utils')
const createActions = require('../lib/actions')
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
      [TYPE]: MESSAGE_TYPE,
      [SIG]: 'bs1',
      a: 1
    },
    b1: {
      [TYPE]: 'something else',
      [SIG]: 'bs2',
      b: 1
    },
    c1: {
      [TYPE]: MESSAGE_TYPE,
      [SIG]: 'bs3',
      c: 1
    }
  }

  const keeper = helpers.nextDB()
  const batch = utils.mapToBatch(keyToVal)
  keeper.batch(batch, start)

  const authorLink = 'bob'
  const bob = helpers.dummyIdentity(authorLink)

  const changes = helpers.nextFeed()
  const actions = createActions({ changes })

  const objectDB = createObjectDB({
    keeper: keeper,
    db: helpers.nextDB(),
    changes: changes,
    identityInfo: bob
  })

  actions.createObject({
    object: keyToVal.a1,
    permalink: 'a1',
    link: 'a1',
    author: authorLink
  })

  actions.createObject({
    object: keyToVal.b1,
    permalink: 'b1',
    link: 'b1',
    author: authorLink
  })

  let failedOnce
  const unsent = batch.map(row => row.value).filter(val => val[TYPE] === MESSAGE_TYPE)
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
    objects: objectDB,
    actions: actions
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

    setTimeout(function () {
      // check that live stream is working

      actions.createObject({
        object: keyToVal.c1,
        permalink: 'c1',
        link: 'c1',
        author: authorLink
      })
    }, 100)
  }
})
