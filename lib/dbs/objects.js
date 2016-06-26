
'use strict'

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db:objects')
const indexer = require('feed-indexer')
const Readable = require('readable-stream').Readable
const constants = require('../constants')
const utils = require('../utils')
const Status = require('../status')
const SealStatus = Status.seal
const SendStatus = Status.send
const topics = require('../topics')
const types = require('../types')
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
    topics.queueseal,
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
      case topics.queueseal:
        newState = state ? utils.clone(state) : utils.pick(changeVal, 'link')
        newState.sealstatus = SealStatus.pending
        break
      case topics.readseal:
      case topics.wroteseal:
        newState = utils.clone(state)
        newState.sealstatus = SealStatus.sealed
        newState.txId = changeVal.txId
        newState.confirmations = changeVal.confirmations
        if (changeVal.sealAddress) newState.sealAddress = changeVal.sealAddress
        if (changeVal.sealPrevAddress) newState.sealPrevAddress = changeVal.sealPrevAddress
        break
      case topics.archiveobj:
      case topics.unarchiveobj:
        newState = utils.clone(state)
        newState.archived = changeVal.topic === topics.archiveobj
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
    'confirmations',
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

  indexes.unsentTo = indexedDB.by('unsentTo', function (state) {
    if (state.type === MESSAGE_TYPE) {
      if (!state.recipient) throw new Error('expected "recipient"')

      return state.sendstatus + sep + state.recipient + sep + state.link
    }
  })

  const keeper = opts.keeper
  indexedDB.on('change', function (change, newState, oldState) {
    const event = getEvent(change.value, oldState)
    if (!event) return

    keeper.get(newState.link, function (err, body) {
      if (err) return emitter.emit('error', err)

      newState = utils.clone(newState)
      newState.object = body
      emitter.emit(event, newState)
    })
  })

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

  function getEvent (change, oldState) {
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
      // only emit for new seals
      if (oldState.confirmations == null) return 'readseal'
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

  // function list (type, cb) {
  //   if (typeof type === 'function') {
  //     cb = type
  //     type = null
  //   }

  //   const stream = type
  //     ? indexes.type.createReadStream({ eq: type, keys: false })
  //     : indexes.latest.createReadStream({ keys: false })

  //   return collect(stream, cb)
  // }

  function byType (type, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = null
    }

    opts = utils.extend({ eq: type, keys: false }, opts || {})
    return collect(indexes.type.createReadStream(opts), wrapCallback(cb))
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

      if (!opts.archived) {
        pipeline.push(utils.filterStream(notArchived))
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
    findOneByProp(prop, val, cb)
  }

  emitter.find = function (prop, val, cb) {
    findByProp(prop, val, cb)
  }

  function findByProp (prop, val, cb) {
    indexes[prop].find({ eq: val, keys: false }, wrapCallback(cb))
  }

  function findOneByProp (prop, val, cb) {
    indexes[prop].findOne({ eq: val, keys: false }, wrapCallback(cb))
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

  // function getValue (data, prop, opts) {
  //   if (opts) {
  //     if (opts.keys === false) return data[prop]
  //     if (opts.values === false) return undefined
  //   }

  //   return data.value[prop]
  // }

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

  function wrapStream (stream, opts) {
    if (opts.archived) return stream

    return stream.pipe(utils.filterStream(notArchived))
  }

  function notArchived (data) {
    return !data.archived
  }

  function wrapCallback (cb, opts) {
    if (opts && opts.archived) return cb

    return function (err, data) {
      if (err || !data.archived) return cb(err, data)

      cb(utils.notFoundErr())
    }
  }

  return utils.extend(emitter, {
    index: indexes,
    get: function (link, getBody, cb) {
      if (typeof getBody === 'function') {
        cb = getBody
        getBody = false
      }

      indexedDB.get(link, wrapCallback(function (err, info) {
        if (err || !getBody) return cb(err, info)

        keeper.get(link, function (err, body) {
          if (err) return cb(err)

          info.object = body
          cb(null, info)
        })
      }))
    },
    // get: function (link, cb) {
    //   indexedDB.get(link, checkNotArchived(cb))
    // },
    byPermalink: function byPermalink (permalink, cb)  {
      findOneByProp('latest', permalink, cb)
    },
    // byPermalink: function (permalink, cb)  {
    //   indexes.latest.findOne(permalink, checkNotArchived(cb))
    // },
    unsent: function (opts) {
      opts = opts || {}
      opts.eq = SendStatus.pending
      return indexes.sendstatus.createReadStream(opts)
      // return pump(
      //   raw,
      //   filterArchived(opts)
      // )
    },
    unsentTo: function (recipient, opts) {
      opts = opts || {}
      opts.eq = SendStatus.pending + sep + recipient
      return indexes.unsentTo.createReadStream(opts)
    },
    unsealed: function (opts) {
      opts = opts || {}
      opts.eq = SealStatus.pending
      return indexes.sealstatus.createReadStream(opts)
    },
    sealed: function (opts) {
      return indexes.confirmations.createReadStream({ gte: opts.confirmations || 0 })
    },
    // createReadStream: createReadStream,
    list: function (opts, cb) {
      if (typeof opts === 'function') {
        cb = opts
        opts = null
      }

      opts = utils.extend({ keys: false }, opts || {})
      return collect(indexes.latest.createReadStream(opts), cb)
    },
    messages: function (opts) {
      return byType(MESSAGE_TYPE, opts)
    },
    // messages: list.bind(null, MESSAGE_TYPE),
    from: from,
    to: to,
    type: byType,
    exists: function (link, cb) {
      indexedDB.get(link, wrapCallback(err => cb(!err)))
    },
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
