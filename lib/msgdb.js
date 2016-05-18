
'use strict'

const extend = require('xtend/mutable')
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const LiveStream = require('level-live-stream')
const protocol = require('@tradle/protocol')
const constants = require('@tradle/constants')
const utils = require('./utils')
const assert = utils.assert
const Status = require('./status')
const topics = require('./topics')
const types = require('./types')
const changeProcessor = require('level-change-processor')
const IDENTITY = constants.TYPES.IDENTITY
const CUR_HASH = constants.CUR_HASH
const ROOT_HASH = constants.ROOT_HASH
const MSG_ID_PREFIX = 'm!'
const SEPARATOR = '!'

// messages shouldn't be stored differently form
// other objects. This will create annoying asymmetry for message/object seals

module.exports = function (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: types.keeper
  }, opts)

  const db = opts.db
  const changes = opts.changes
  const processor = changeProcessor({
    feed: changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  const indexedProps = ['sealstatus', 'sendstatus', 'watchstatus', 'type', CUR_HASH, ROOT_HASH]

  // const sent = liveDB(db, 'u1', { valueEncoding: 'utf8 '})
  // const unsent = liveDB(db, 'u2', { valueEncoding: 'utf8 '})
  // LiveStream.install(unsent)

  // const sealed = liveDB(db, 'u3', { valueEncoding: 'utf8' })
  // const unsealed = liveDB(db, 'u4', { valueEncoding: 'utf8' })
  // LiveStream.install(unsealed)

  const main = liveDB(db, 'm', { valueEncoding: 'json' })
  LiveStream.install(main)
  utils.addLiveMethods(main, processor)

  const index = liveDB(db, 'x', { valueEncoding: 'json' })
  LiveStream.install(index)
  utils.addLiveMethods(index, processor)

  // const byCurHash = liveDB(db, 'c')
  // const byRootHash = liveDB(db, 'r')

  const keeper = opts.keeper
  const relevantTopics = [
    topics.msg,
    topics.seal
  ]

  function worker (change, cb) {
    const val = change.value
    if (!val[CUR_HASH] || relevantTopics.indexOf(val.topic) === -1) return cb()

    main.get(val.msgID, function (err, val) {
      let state
      if (err) {
        state = change.value
      } else {
        state = extend(val, change.value)
      }

      const batch = getBatch(state, change.change)
      // console.log(batch)
      db.batch(batch, cb)
    })
  }

  function getBatch (state, change) {
    const msgID = state.msgID
    const batch = indexedProps.map(prop => {
      if (!(prop in state)) return

      return {
        type: 'put',
        db: index,
        key: [prop, state[prop], msgID].join(SEPARATOR),
        value: msgID
      }
    })
    .filter(row => row)

    if (state.sealstatus === Status.seal.sealed) {
      batch.push({
        type: 'del',
        db: index,
        key: ['sealstatus', Status.seal.unsealed, msgID].join(SEPARATOR)
      })
    }

    if (state.sendstatus === Status.send.sent) {
      batch.push({
        type: 'del',
        db: index,
        key: ['sendstatus', Status.send.unsent, msgID].join(SEPARATOR)
      })
    }

    // if (state.watchstatus === Status.watch.seen || state.watchstatus === Status.watch.confirmed) {
    //   batch.push({
    //     type: 'del',
    //     db: index,
    //     key: ['sendstatus', Status.watch.unseen, msgID].join(SEPARATOR)
    //   })
    // }

    batch.push({
      type: 'put',
      db: main,
      key: msgID,
      value: state
    })

    return utils.encodeBatch(batch)
  }

  function list (type, cb) {
    if (typeof type === 'function') {
      cb = type
      type = null
    }

    collect(streams.type(type, { body: true }), cb)
  }

  function createIndexStream (prop, value, opts) {
    opts = opts || {}
    opts.gt = prop + SEPARATOR
    if (value != null) {
      opts.gt += value + SEPARATOR
    }

    opts.lt = opts.gt + '\xff'
    opts.keys = opts.values = true

    const pipeline = [
      index.live.createReadStream(opts),
      through.obj(function (data, enc, cb) {
        if (data.type === 'del') cb()
        else cb(null, data.value) // figure out how to make it store utf8
      }),
      lookupMsg()
    ]

    if (opts.body) pipeline.push(getBody())

    return pump.apply(null, pipeline)
  }

  // function createReadStream (db, opts) {
  //   opts = extend({
  //     tail: true,
  //     old: true,
  //     live: true
  //   }, opts)

  //   opts.keys = opts.values = true
  //   const source = db.live.createReadStream(opts)
  //   return pump(
  //     source,
  //     through.obj(function (data, enc, cb) {
  //       if (data.type === 'del') cb()
  //       else cb(null, db._codec.decodeValue(data.value)) // figure out how to make it store utf8
  //     }),
  //     lookupMsg(),
  //     getBody()
  //   )
  // }

  function lookupMsg () {
    return through.obj(function (msgID, enc, cb) {
      main.get(msgID.toString(), cb)
    })
  }

  function getBody () {
    return through.obj(function (data, enc, cb) {
      keeper.get(data[CUR_HASH], function (err, body) {
        if (err) return cb(err)

        data.object = body
        cb(null, data)
      })
    })
  }

  function liveDB () {
    const db = subdown.apply(null, arguments)
    return utils.addLiveMethods(db, processor)
  }

  const streams = {}
  // indexedProps.forEach(prop => {
  //   streams[prop] = function createReadStream (opts) {
  //     return createIndexStream(prop, null, opts)
  //   }
  // })

  streams.type = function (type, opts) {
    return createIndexStream('type', type, opts)
  }

  streams.unsent = function (opts) {
    return createIndexStream('sendstatus', Status.send.unsent, opts)
  }

  streams.unsealed = function (opts) {
    return createIndexStream('sealstatus', Status.seal.unsealed, opts)
  }

  return {
    streams: streams,
    hasSealWithID: function hasSealWithID (sealID, cb) {
      async.some([unsealed, sealed].map(db => {
        return function get (done) {
          db.live.get(sealID, done)
        }
      }), cb)
    },
    // unsealedStream: function getUnsealed (opts) {
    //   return createReadStream(unsealed, opts)
    // },
    list: list,
    get: function get (msgID, cb) {
      processor.onLive(() => main.get(msgID, cb))
    },
    conversation: function (a, b, cb) {
      throw new Error('not implemented')
    }
  }
}

// function getPrevHash (msg) {
//   return msg[ROOT_HASH] === msg[CUR_HASH] ? null : msg[PREV_HASH] || msg[ROOT_HASH]
// }
