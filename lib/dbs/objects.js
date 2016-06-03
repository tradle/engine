
'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db')
const indexer = require('feed-indexer')
const Readable = require('readable-stream').Readable
const changeProcessor = require('../change-processor')
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
const ENTRY_PROP = '_'

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
  const myDebug = utils.subdebugger(debug, me.permalink.slice(0, 6))
  const emitter = new EventEmitter()
  const changes = opts.changes
  const objTopics = [
    topics.newobj,
    topics.archiveobj,
    topics.unarchiveobj,
    topics.sent,
    // topics.received,
    topics.readseal,
    topics.wroteseal
  ]

  // we want to monitor each version being sent/sealed etc.
  const primaryKey = 'link'
  const indexedDB = indexer({
    feed: changes,
    db: opts.db,
    primaryKey: primaryKey,
    entryProp: ENTRY_PROP,
    filter: function (val) {
      return objTopics.indexOf(val.topic) !== -1
    },
    reduce: function (state, change, cb) {
      let newState
      const changeVal = change.value

      switch (changeVal.topic) {
      case topics.readseal:
      case topics.wroteseal:
        newState = utils.clone(state)
        newState.sealstatus = SealStatus.sealed
        newState.txId = changeVal.txId
        if (changeVal.sealAddress) newState.sealAddress = changeVal.sealAddress
        if (changeVal.sealPrevAddress) newState.sealPrevAddress = changeVal.sealPrevAddress
        break
      default:
        newState = indexedDB.merge(state, change)
        break
      }

      cb(null, newState)
    }
  })

  const sep = indexedDB.separator

  // maybe these props should
  const indexedProps = [
    'sealstatus',
    'sendstatus',
    'watchstatus',
    // 'archived',
    /*'type',*/
    'link',
    'prevLink',
    'permalink',
    'txId'
  ]

  const indexes = {}
  indexedProps.forEach(prop => indexes[prop] = indexedDB.by(prop))

  // need this because the by('permalink') points to 'link'
  indexes.latest = indexedDB.by('latest', function (state) {
    return state.permalink + sep + state.permalink
  })

  // latest versions only
  indexes.type = indexedDB.by('type', function (state) {
    return state.type && state.permalink
      ? state.type + sep + state.permalink
      : undefined
  })

  indexes.from = indexedDB.by('from', function (state, change) {
    if (state.type === MESSAGE_TYPE) {
      if (!state.author) throw new Error('expected "author"')

      return state.author + sep + state.link
    }
  })

  indexes.to = indexedDB.by('to', function (state) {
    if (state.type === MESSAGE_TYPE) {
      if (!state.recipient) throw new Error('expected "recipient"')

      return state.recipient + sep + state.link
    }
  })

  const keeper = opts.keeper
  indexedDB.on('change', function (change, newState) {
    const event = getEvent(change.value)
    if (!event) return

    keeper.get(newState.link, function (err, body) {
      if (err) return emitter.emit('error', err)

      newState = utils.clone(newState)
      newState.object = body
      emitter.emit(event, newState)
    })
  })

  function createReadStream (opts) {
    opts = opts || {}

    const pipeline = [
      indexes.latest.createReadStream(opts)
    ]

    if (opts.body !== false) pipeline.push(getBody(opts))

    return pump.apply(null, pipeline)
  }

  function getBody (opts) {
    return through.obj(function (data, enc, cb) {
      const val = opts.keys === false ? data : data.value
      keeper.get(val.link, function (err, body) {
        if (err) return cb(err)

        val.object = body
        cb(null, opts.keys === false ? val : data)
      })
    })
  }

  function getEvent (change) {
    switch (change.topic) {
    case topics.newobj:
      if (change.author !== me.permalink && change.type === MESSAGE_TYPE) {
        return 'message'
      }

      return
    case topics.sent:
      return 'sent'
    case topics.wroteseal:
      return 'wroteseal'
    case topics.readseal:
      return 'readseal'
    // case topics.received:
    //   return 'message'
    }
  }

  /**
   * list objects by type (convenience method)
   * @param  {String}   type
   * @param  {Function} cb
   * @return {Stream}
   */
  // function list (type, cb) {
  //   if (typeof type === 'function') {
  //     cb = type
  //     type = null
  //   }

  //   const stream = type
  //     ? indexAPIs.type.createReadStream(type)//.on('data', console.log)
  //     : createReadStream()

  //   return collect(stream, cb)
  // }

  function list (type, cb) {
    if (typeof type === 'function') {
      cb = type
      type = null
    }

    const stream = type
      ? indexes.type.createReadStream({ eq: type, keys: false })
      : indexes.latest.createReadStream({ keys: false })

    return collect(stream, cb)
  }

  Object.keys(indexes).forEach(prop => {
    const index = indexes[prop]
    const createReadStream = index.createReadStream
    index.createReadStream = function (opts) {
      opts = opts || {}
      if (typeof opts === 'string') opts = { eq: opts }

      const pipeline = [ createReadStream.call(index, opts) ]
      // if (opts.excludeArchived !== false) {
      //   pipeline.push(filterArchived(opts))
      // }

      if (opts.body !== false) {
        pipeline.push(getBody(opts))
      }

      return pipeline.length === 1 ? pipeline[0] : pump.apply(null, pipeline)
    }
  })

  // indexedProps.concat('latest', 'type').forEach(prop => {
  //   indexAPIs[prop] = {
  //     find: indexes[prop].find,
  //     findOne: indexes[prop].findOne,
  //     createReadStream:
  //   }
  // })

  emitter.findOne = function (prop, val, cb) {
    indexes[prop].findOne(val, cb)
  }

  emitter.find = function (prop, val, cb) {
    indexes[prop].find(val, cb)
  }

  function from (permalink, cb) {
    return indexes.from.createReadStream({ eq: permalink, keys: false, body: false })
  }

  function to (permalink, cb) {
    return indexes.to.createReadStream({ eq: permalink, keys: false, body: false })
  }

  // function checkNotArchived (cb) {
  //   return function (err, result) {
  //     if (err) return cb(err)
  //     if (result.archived) return cb(utils.notFoundErr())
  //     cb(null, result)
  //   }
  // }

  // function filterArchived (opts) {
  //   return utils.filterStream(data => !getValue(data, 'archived', opts))
  // }

  function getValue (data, prop, opts) {
    if (opts) {
      if (opts.keys === false) return data[prop]
      if (opts.values === false) return undefined
    }

    return data.value[prop]
  }

  function streamFromTo (permalinkFrom, permalinkTo) {
    return pump(
      from(permalinkFrom),
      through.obj(function (data, enc, cb) {
        if (data.recipient === permalinkTo) {
          cb(null, data)
        } else {
          cb()
        }
      })
    )
  }

  return utils.extend(emitter, {
    index: indexes,
    get: indexedDB.get,
    // get: function (link, cb) {
    //   indexedDB.get(link, checkNotArchived(cb))
    // },
    byPermalink: function byPermalink (permalink, cb)  {
      indexes.latest.findOne(permalink, cb)
    },
    // byPermalink: function (permalink, cb)  {
    //   indexes.latest.findOne(permalink, checkNotArchived(cb))
    // },
    unsent: function (opts, cb) {
      opts = opts || {}
      opts.eq = SendStatus.pending
      const raw = indexes.sendstatus.createReadStream(opts)
      return raw
      // return pump(
      //   raw,
      //   filterArchived(opts)
      // )
    },
    unsealed: function (opts, cb) {
      opts = opts || {}
      opts.eq = SealStatus.pending
      const raw = indexes.sealstatus.createReadStream(opts)
      return raw
      // return pump(
      //   raw,
      //   filterArchived(opts)
      // )
    },
    createReadStream: createReadStream,
    list: list,
    messages: list.bind(null, MESSAGE_TYPE),
    from: from,
    to: to,
    conversation: function (permalinkFrom, permalinkTo) {
      if (!permalinkTo) permalinkTo = me.permalink

      const fromTo = streamFromTo(permalinkFrom, permalinkTo)
      const toFrom = streamFromTo(permalinkTo, permalinkFrom)
      return pump(
        utils.mergeStreams([fromTo, toFrom], byLogPosition),
        getBody({ keys: false })
      )

      // const tr = filterArchived({ keys: false })
      // pump(fromTo, tr)
      // pump(toFrom, tr)
      // return tr
    }
  })
}

function byLogPosition (a, b) {
  return a[ENTRY_PROP] - b[ENTRY_PROP]
}
