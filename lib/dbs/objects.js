
'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db')
const changeProcessor = require('level-change-processor')
const protocol = require('@tradle/protocol')
const Indexer = require('../indexer')
const indexers = Indexer.indexers
const constants = require('../constants')
const utils = require('../utils')
const Status = require('../status')
const SealStatus = Status.seal
const SendStatus = Status.send
const topics = require('../topics')
const types = require('../types')
const reducer = require('../reducers').object
const IDENTITY = constants.TYPES.IDENTITY
const MESSAGE_TYPE = constants.TYPES.MESSAGE
const LINK = constants.LINK
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const SEPARATOR = constants.INDEX_SEPARATOR

// messages shouldn't be stored differently form
// other objects. This will create annoying asymmetry for message/object seals

module.exports = exports = createObjectDB

function createObjectDB (opts) {
  typeforce({
    db: types.db,
    keeper: types.keeper,
    changes: types.changes,
    identityInfo: types.identityInfo
  }, opts)

  const me = opts.identityInfo
  const emitter = new EventEmitter()
  const db = opts.db
  const changes = opts.changes
  const processor = changeProcessor({
    feed: changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  // maybe these props should
  // const indexedProps = ['sealstatus', 'sendstatus', 'watchstatus', 'type', LINK, PERMALINK]

  // const sent = liveDB(db, 'u1', { valueEncoding: 'utf8 '})
  // const unsent = liveDB(db, 'u2', { valueEncoding: 'utf8 '})
  // LiveStream.install(unsent)

  // const sealed = liveDB(db, 'u3', { valueEncoding: 'utf8' })
  // const unsealed = liveDB(db, 'u4', { valueEncoding: 'utf8' })
  // LiveStream.install(unsealed)

  // NOTE: these dbOpts don't actually do anything at the moment
  // because batches get pushed to the top level db
  const dbOpts = { valueEncoding: utils.clone(utils.defaultValueEncoding) }
  const main = utils.live(subdown(db, 'm', dbOpts), processor)
  const indexDB = utils.live(subdown(db, 'x', dbOpts), processor)
  const index = indexers.object(main, indexDB)

  // const sealIndex = liveDB(db, 's', dbOpts)
  // const watchIndex = liveDB(db, 'w', dbOpts)

  // const byCurHash = liveDB(db, 'c')
  // const byRootHash = liveDB(db, 'r')

  // const getObjectBatch = indexers.object(main, objIndex)
  // const getSealBatch = indexers.seal(main, sealIndex)
  // const getWatchBatch = indexers.watch(main, watchIndex)

  const keeper = opts.keeper
  const objTopics = [
    topics.newobj,
    topics.sent,
    topics.received,
    topics.readseal,
    topics.wroteseal
  ]

  // const sealTopics = [
  //   topics.queueseal,
  //   topics.readseal,
  //   topics.wroteseal
  // ]

  // const watchTopics = [
  //   topics.readseal,
  //   topics.newwatch,
  //   topics.tx
  // ]

  function worker (change, cb) {
    // if (!changeVal.link || relevantTopics.indexOf(changeVal.topic) === -1) return cb()

    // validation done on API level
    // if (val[PERMALINK] && !val[PREVLINK]) {
    //   debug('ignoring object with root hash but no prev hash')
    //   return cb()
    // }

    // keep in mind: val[PERMALINK] cannot be trusted

    const topic = change.value.topic

    // if (topic === topics.tx) {
    //   return processTx(change, cb)
    // }

    if (objTopics.indexOf(topic) !== -1) {
      return processObjectChange(change, cb)
    }

    // if (sealTopics.indexOf(topic) !== -1) {
    //   return processSealChange(change, cb)
    // }

    // if (watchTopics.indexOf(topic) !== -1) {
    //   return processWatchChange(change, cb)
    // }

    cb()
  }

  // function processSealChange (change, cb) {
  //   const changeVal = change.value
  //   const uid = changeVal.uid = utils.sealUID(changeVal)
  //   main.get(uid, function (err, state) {
  //     const newState = reducer(state, changeVal)
  //     const batch = getSealBatch(state, newState)
  //     saveAndEmit(batch, newState, changeVal, cb)
  //   })
  // }

  function processObjectChange (change, cb) {
    const changeVal = change.value
    changeVal.uid = utils.uid(changeVal)

    const lookupUID = changeVal.prevLink ? utils.prevUID(changeVal) : changeVal.uid
    main.get(lookupUID, function (err, state) {
      const newState = reducer(state, changeVal)
      if (!newState) return cb()

      const batch = index.batch(state, newState)
      saveAndEmit(batch, newState, changeVal, cb)
    })
  }

  // function processWatchChange (change, cb) {
  //   const changeVal = change.value
  //   const uid = changeVal.uid = utils.watchUID(changeVal)
  //   main.get(uid, function (err, state) {
  //     const newState = reducer(state, changeVal)
  //     const batch = getWatchBatch(state, newState)
  //     // in-elegant cross-document-type batch
  //     // if (newState.sealstatus === )

  //     saveAndEmit(batch, newState, changeVal, cb)
  //   })
  // }

  function saveAndEmit (batch, newState, changeVal, cb) {
    batch = utils.encodeBatch(batch)
    db.batch(batch, function (err) {
      if (err) return cb(err)

      cb()

      let event = getEvent(changeVal)
      if (event) emitter.emit(event, newState)
    })
  }

  // function getBatch (state, change) {
  //   const uid = getUID(state)
  //   const batch = indexedProps.map(prop => {
  //     if (!(prop in state)) return

  //     return {
  //       type: 'put',
  //       db: index,
  //       key: [prop, state[prop], rootHash].join(SEPARATOR),
  //       value: rootHash
  //     }
  //   })
  //   .filter(row => row)

  //   // could be generalized to any enum-valued properties
  //   if (state[TYPE] === MESSAGE_TYPE) {
  //     if (state.sealstatus === SealStatus.sealed) {
  //       batch.push({
  //         type: 'del',
  //         db: index,
  //         key: ['sealstatus', SealStatus.pending, msgID].join(SEPARATOR)
  //       })
  //     }

  //     if (state.sendstatus === SendStatus.sent) {
  //       batch.push({
  //         type: 'del',
  //         db: index,
  //         key: ['sendstatus', SendStatus.pending, msgID].join(SEPARATOR)
  //       })
  //     }
  //   }

  //   // if (state.watchstatus === Status.watch.seen || state.watchstatus === Status.watch.confirmed) {
  //   //   batch.push({
  //   //     type: 'del',
  //   //     db: index,
  //   //     key: ['sendstatus', Status.watch.unseen, msgID].join(SEPARATOR)
  //   //   })
  //   // }

  //   batch.push({
  //     type: 'put',
  //     db: main,
  //     key: msgID,
  //     value: state
  //   })

  //   return utils.encodeBatch(batch)
  // }

  function list (type, cb) {
    if (typeof type === 'function') {
      cb = type
      type = null
    }

    collect(streams.type(type, { body: true }), cb)
  }

  function createIndexStream (prop, value, opts) {
    let stream = index.createIndexStream(prop, value, opts)
    if (opts.body) {
      stream = pump(stream, getBody())
    }

    return stream
  }

  // function getFromIndex (index, prop, value, cb) {
  //   return collect(createIndexStream(index, prop, value), cb)
  // }

  // function firstFromIndex (index, prop, value, cb) {
  //   getFromIndex(index, prop, addr, function (err, results) {
  //     done(null, results && results[0])
  //   })
  // }

  // function createIndexStream (index, prop, value, opts) {
  //   opts = opts || {}
  //   opts.keys = opts.values = true
  //   utils.extend(opts, Indexer.getRangeOpts(prop, value))

  //   const pipeline = [
  //     // any index
  //     index.live.createReadStream(opts),
  //     through.obj(function (data, enc, cb) {
  //       if (data.type === 'del') cb()
  //       else cb(null, data.value) // figure out how to make it store utf8
  //     }),
  //     lookupObject()
  //   ]

  //   if (opts.body) pipeline.push(getBody())

  //   return pump.apply(null, pipeline)
  // }

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
  //     lookupObject(),
  //     getBody()
  //   )
  // }

  function getBody () {
    return through.obj(function (data, enc, cb) {
      keeper.get(data.link, function (err, body) {
        if (err) return cb(err)

        data.object = body
        cb(null, data)
      })
    })
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
    return createIndexStream('sendstatus', SendStatus.pending, opts)
  }

  // streams.unsealed = function (opts) {
  //   return createIndexStream(sealIndex, 'sealstatus', SealStatus.pending, opts)
  // }

  streams.messages = function (opts) {
    streams.type(MESSAGE_TYPE, opts)
  }

  function byUID (uid, cb) {
    processor.onLive(() => main.get(uid, cb))
  }

  function byPermalink (permalink, cb) {
    processor.onLive(() => {
      main.get(permalink, function (err, uid) {
        if (err) return cb(err)

        byUID(uid, cb)
      })
    })
  }

  function getEvent (change) {
    switch (change.topic) {
    case topics.newobj:
      return change.author !== me.permalink ? 'received' : null
    case topics.sent:
      return 'sent'
    case topics.wroteseal:
      return 'wroteseal'
    case topics.readseal:
      return 'readseal'
    case topics.received:
      return 'received'
    }
  }

  return utils.extend(emitter, {
    streams: streams,
    hasSealWithID: function hasSealWithID (sealID, cb) {
      main.live.get(sealID, done)
    },
    // unsealedStream: function getUnsealed (opts) {
    //   return createReadStream(unsealed, opts)
    // },
    list: list,
    byPermalink: byPermalink,
    get: byUID,
    byUID: byUID,
    conversation: function (a, b, cb) {
      throw new Error('not implemented')
    }
  })
}

function getUID (state) {
  return state[PERMALINK] + SEPARATOR + state[LINK]
}

// function getPrevHash (msg) {
//   return msg[PERMALINK] === msg[LINK] ? null : msg[PREVLINK] || msg[PERMALINK]
// }
