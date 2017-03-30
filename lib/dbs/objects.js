
'use strict'

/** @module objectsDB */

const EventEmitter = require('events').EventEmitter
const collect = require('stream-collector')
const async = require('async')
const pump = require('pump')
const through = require('through2')
const typeforce = require('../typeforce')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:db:objects')
const indexer = require('feed-indexer')
const Readable = require('readable-stream').Readable
const lexint = require('lexicographic-integer')
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
const SEQ = constants.SEQ
const PREV_TO_SENDER = constants.PREV_TO_SENDER
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const SEPARATOR = constants.INDEX_SEPARATOR
const ENTRY_PROP = constants.ENTRY_PROP

// messages shouldn't be stored differently form
// other objects. This will create annoying asymmetry for message/object seals

module.exports = exports = createObjectDB

/**
 * @typedef {Object} objectsDB
 */

/**
 * @alias module:objectsDB
 * @param  {Object} opts
 * @param  {Levelup} opts.db
 * @param  {Keeper} opts.keeper
 * @param  {changes} opts.changes
 * @param  {IdentityInfo} opts.identityInfo
 * @return {Object}
 */
function createObjectDB (opts) {
  typeforce({
    db: types.db,
    keeper: types.keeper,
    changes: types.changes,
    identityInfo: types.identityInfo
  }, opts)

  let closed
  opts.db.once('closing', () => closed = true)

  const me = opts.identityInfo
  const myDebug = utils.subdebugger(debug, opts.name || me.permalink.slice(0, 6))
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
      const topic = changeVal.topic

      switch (topic) {
        case topics.queueseal: {
          newState = state ? utils.clone(state) : utils.pick(changeVal, 'link')
          newState.sealstatus = SealStatus.pending
          break
        }
        case topics.readseal:
        case topics.wroteseal: {
          newState = state ? utils.clone(state) : utils.pick(changeVal, 'link')
          newState.sealstatus = SealStatus.sealed
          newState.txId = changeVal.txId
          newState.confirmations = changeVal.confirmations
          if (changeVal.sealAddress) newState.sealAddress = changeVal.sealAddress
          if (changeVal.sealPrevAddress) newState.sealPrevAddress = changeVal.sealPrevAddress
          break
        }
        case topics.archiveobj:
        case topics.unarchiveobj: {
          newState = state ? utils.clone(state) : utils.pick(changeVal, 'link')
          const archiving = newState.archived = topic === topics.archiveobj
          myDebug(`${archiving ? '': 'un'}archiving object: ${newState.link}`)
          break
        }
        default: {
          newState = indexedDB.merge(state, change)
          break
        }
      }

      delete newState.topic
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
    // cannot retain log order here
    // if log entry link is inserted, this index will not be overwritten
    // on modifications to an object, as a modified object has a new `link`
    return state.type && state.permalink
      ? state.type + sep + state.permalink
      : undefined
  })

  indexes.from = indexedDB.by('from', function (state, change) {
    if (state.type === MESSAGE_TYPE) {
      // retain log order
      return state.author + sep + getEntryLink(state) + sep + state.link
    }
  })

  indexes.to = indexedDB.by('to', function (state) {
    if (state.type === MESSAGE_TYPE) {
      // retain log order
      return state.recipient + sep + getEntryLink(state) + sep + state.link
    }
  })

  indexes.sendstatus = indexedDB.by('sendstatus', function (state) {
    if (state.type === MESSAGE_TYPE && typeof state.sendstatus !== 'undefined') {
      return state.sendstatus + sep +
        state.recipient + sep +
        // retain log order
        getEntryLink(state) + sep +
        state.link
    }
  })

  indexes.seq = indexedDB.by('seq', function (state) {
    if (state.type === MESSAGE_TYPE) {
      // only one value per recipient

      return state.author + sep + state.recipient + sep + hexint(state.seq)
    }
  })

  // indexes.gap = indexedDB.by('gap', function (state, change, oldState) {
  //   if (state.type === MESSAGE_TYPE) {
  //     // only one value per recipient
  //     if (change.value.topic === topics.newobj) {
  //       const oldSeq = oldState ? parseSeq(oldState.seq) : -1
  //       const newSeq = state.seq
  //       console.log(oldSeq, newSeq)
  //       if (newSeq === oldSeq + 1) {
  //         return state.author + sep + state.recipient + sep + hexint(state.seq)
  //       }
  //
  //       console.log("GAP starts at", oldSeq)
  //     }
  //   }
  // })

  indexes.messagesWithObject = indexedDB.by('messagesWithObject', function (state) {
    if (state.type === MESSAGE_TYPE) {
      return state.objectinfo.permalink + sep + state.objectinfo.link + sep + state.permalink
    }
  })

  const keeper = opts.keeper
  indexedDB.on('change', function (change, newState, oldState) {
    if (closed) return

    const event = getEvent(change.value, oldState)
    if (!event) return

    keeper.get(newState.link, function (err, body) {
      if (err) return emitter.emit('error', err)

      newState = utils.clone(newState)
      newState.object = body
      emitter.emit(event, newState)
    })
  })

  function addBodyTransform (opts) {
    return through.obj(function (data, enc, cb) {
      const val = opts.keys === false ? data : data.value
      addBody(val, function (err) {
        if (err) return cb(err)

        cb(null, opts.keys === false ? val : data)
      })
    })
  }

  function addBody (val, cb) {
    if (closed) return

    keeper.get(val.link, function (err, body) {
      if (err) return cb(err)

      val.object = body
      cb(null, val)
    })
  }

  function getEvent (change, oldState) {
    switch (change.topic) {
    case topics.newobj:
      if (change.recipient === me.permalink &&
          change.author !== me.permalink &&
          change.type === MESSAGE_TYPE) {
        return 'message'
      }

      return
    case topics.sent:
      return 'sent'
    case topics.wroteseal:
      return 'wroteseal'
    case topics.readseal:
      // only emit for new seals
      if (!oldState || oldState.confirmations == null) return 'readseal'
    // case topics.received:
    //   return 'message'
    }
  }

  /**
   * stream objects by type
   * @param  {string}    type
   * @param  {Object}    [opts]
   * @param  {boolean}   [opts.body=true]
   * @param  {boolean}   [opts.archived=false]
   * @return {stream}
   */
  function byType (type, opts) {
    opts = utils.extend({ eq: type, keys: false }, opts || {})
    return indexes.type.createReadStream(opts)
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

      if (!opts.archived) {
        pipeline.push(utils.filterStream(notArchived))
      }

      if (opts.body !== false) {
        pipeline.push(addBodyTransform(opts))
      }

      return executePipeline(pipeline)
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

  function streamBySeq (opts) {
    return indexes.seq.createReadStream(utils.extend({ keys: false, body: false }, opts))
  }

  function from (opts) {
    return indexes.from.createReadStream(utils.extend({ keys: false, body: false }, opts))
  }

  function to (opts) {
    return indexes.to.createReadStream(utils.extend({ keys: false, body: false }, opts))
  }

  function streamFromTo (opts) {
    const to = opts.to
    const fromOpts = utils.omit(opts, 'from', 'to')
    fromOpts.eq = opts.from
    return pump(
      from(fromOpts),
      through.obj(function (data, enc, cb) {
        if (data.recipient === to) {
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
    if (!cb) return utils.noop
    if (opts && opts.archived) return cb

    return function (err, data) {
      if (err || !data.archived) return cb(err, data)

      cb(utils.notFoundErr())
    }
  }

  function maybeAddBody (stream, opts) {
    const pipeline = [ stream ]
    if (opts.body !== false) {
      pipeline.push(addBodyTransform(opts))
    }

    return executePipeline(pipeline)
  }

  function lastMessage (opts, cb) {
    if (!(opts.from || opts.to) || (opts.from && opts.to)) {
      throw new Error('expected "from" OR "to"')
    }

    // cb = once(cb)
    const from = opts.from || me.permalink
    const to = opts.to || me.permalink
    opts = utils.omit(opts, 'from', 'to')
    opts.eq = from + sep + to
    opts.keys = false
    opts.reverse = true
    opts.limit = 1
    utils.firstInStream(indexes.seq.createReadStream(opts), cb)
  }

  function listObjects (opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = null
    }

    return collect(streamLatest(opts), cb)
  }

  function streamLatest (opts) {
    opts = utils.extend({ keys: false }, opts || {})
    return indexes.latest.createReadStream(opts)
  }

  function parseSeq (seqIndexVal) {
    const hex = seqIndexVal.slice(seqIndexVal.lastIndexOf(sep) + sep.length)
    return lexint.unpack([].slice.call(new Buffer(hex, 'hex')))
  }

  return utils.extend(emitter, {
    index: indexes,
    get: function (opts, cb) {
      if (typeof opts === 'string') {
        opts = { link: opts }
      }

      indexedDB.get(opts.link, wrapCallback(function (err, info) {
        if (err || opts.body === false) return cb(err, info)

        addBody(info, cb)
      }, opts))
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
    },
    unsentTo: function (recipient, opts) {
      opts = opts || {}
      opts.eq = SendStatus.pending + sep + recipient
      return indexes.sendstatus.createReadStream(opts)
    },
    unsealed: function (opts={}) {
      opts = opts || {}
      opts.eq = SealStatus.pending
      return indexes.sealstatus.createReadStream(opts)
    },
    sealed: function (opts={}) {
      if (!('gte' in opts)) opts.gte = opts.confirmations || 0

      return indexes.confirmations.createReadStream(opts)
    },
    createReadStream: streamLatest,
    list: listObjects,
    messages: function (opts) {
      return byType(MESSAGE_TYPE, opts)
    },
    // messages: list.bind(null, MESSAGE_TYPE),
    from: from,
    to: to,
    lastMessage: lastMessage,
    type: byType,
    seq: streamBySeq,
    exists: function exists (link, cb) {
      indexedDB.get(link, wrapCallback(err => cb(!err)))
    },
    conversation: function conversation (opts) {
      typeforce({
        with: typeforce.maybe(typeforce.String),
        body: typeforce.maybe(typeforce.Boolean),
        a: typeforce.maybe(typeforce.String),
        b: typeforce.maybe(typeforce.String)
      }, opts)

      if (!(opts.b || opts.with)) {
        throw new Error('expected "with" or "b"')
      }

      const us = opts.a || me.permalink
      const them = opts.b || opts.with
      const outbound = streamFromTo({ from: us, to: them })
      const inbound = streamFromTo({ from: them, to: us })

      const pipeline = [
        utils.mergeStreams([outbound, inbound], byLogPosition)
      ]

      if (opts.body !== false) {
        pipeline.push(addBodyTransform({ keys: false }))
      }

      return executePipeline(pipeline)
    },
    missingMessages: function (opts, cb) {
      typeforce({
        from: typeforce.String,
        tip: typeforce.maybe(typeforce.Number),
        gt: typeforce.maybe(typeforce.Number),
        gte: typeforce.maybe(typeforce.Number)
      }, opts)

      const base = opts.from + sep + me.permalink + sep
      const offset = opts.gt ? opts.gt + 1 : opts.gte || 0
      const stream = new Readable({ objectMode: true })
      stream._read = utils.noop

      let prev = offset - 1
      pump(
        indexes.seq.createReadStream({
          gte: base + hexint(offset),
          lte: base + '\xff',
          archived: true,
          rawIndex: true,
          body: false,
          values: false,
          live: opts.live
        }),
        through.obj(function (key, enc, cb) {
          const seq = parseSeq(key)
          if (seq < prev) {
            // we got a formely missing message, yay!
            return cb()
          }

          addGap(prev, seq)
          prev = seq
          cb()
        }),
        function onend (err) {
          if (err) return stream.emit('error', err)

          if (opts.tip) {
            addGap(prev, opts.tip + 1)
          }

          stream.push(null)
        }
      )

      return collect(stream, cb || utils.noop)

      function addGap (prev, seq) {
        for (let i = prev + 1; i < seq; i++) {
          stream.push(i)
        }
      }
    },
    nextMessageMetadata: function (opts, cb) {
      typeforce({
        with: typeforce.String,
      }, opts)

      lastMessage({
        to: opts.with,
        body: false,
        archived: true
      }, function (err, msg) {
        const seq = err ? 0 : (msg.seq || 0) + 1
        const meta = { [SEQ]: seq }
        if (msg) meta[PREV_TO_SENDER] = msg.link

        cb(null, meta)
      })
    },
    messagesWithObject: function (opts) {
      typeforce({
        permalink: typeforce.String,
        link: typeforce.maybe(typeforce.String)
      }, opts)

      let query = opts.permalink
      if (opts.link) query += sep + opts.link

      return indexes.messagesWithObject.createReadStream({ eq: query, keys: false })
    },
    addBody: addBody
    // nextMessageSeq: function (opts, cb) {
    //   typeforce({
    //     with: typeforce.String,
    //   }, opts)

    //   lastMessage({
    //     to: opts.with
    //   }, function (err, msg) {
    //     const seq = err ? 0 : (msg.object[SEQ] || 0) + 1
    //     cb(null, seq)
    //   })
    // }
  })
}

function byLogPosition (a, b) {
  return a[ENTRY_PROP] - b[ENTRY_PROP]
}

function executePipeline (pipeline) {
  return pipeline.length === 1 ? pipeline[0] : pump.apply(null, pipeline)
}

function getEntryLink (state) {
  return hexint(state[ENTRY_PROP])
}

function hexint (n) {
  return lexint.pack(n, 'hex')
}
