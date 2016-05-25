'use strict'

const typeforce = require('typeforce')
const deepEquals = require('deep-equal')
const pump = require('pump')
const levelErrors = require('level-errors')
const through = require('through2')
const collect = require('stream-collector')
const utils = require('./utils')
const constants = require('./constants')
const statuses = require('./status')
const SealStatus = statuses.seal
const SendStatus = statuses.send
const WatchStatus = statuses.watch
const MESSAGE = constants.TYPES.MESSAGE
const LINK = constants.LINK
const PERMALINK = constants.PERMALINK
const SEPARATOR = constants.INDEX_SEPARATOR

const indexedForAllObjects = [LINK, PERMALINK, 'sealstatus', 'type']
const indexedForObjectsOfType = {
  [MESSAGE]: ['sendstatus']
}

function getIndexedObjectProps (state) {
  if (!Object.keys(state).length) return []

  typeforce({
    type: typeforce.String
  }, state)

  const type = state.type
  const byType = indexedForObjectsOfType[type]
  return indexedForAllObjects.slice().concat(byType || [])
}

function getIndexedSealProps () {
  return ['status', 'link', 'sealAddress', 'sealPrevAddress']
}

function getIndexedWatchProps () {
  return ['address', 'link'] //, 'txId', 'confirmations']
}

// function getIndexedTxProps () {
//   return ['to.addresses']
// }

exports.getRangeOpts = getRangeOpts

function getRangeOpts (prop, value) {
  const opts = {}
  opts.gt = prop + SEPARATOR
  if (value != null) {
    opts.gt += value + SEPARATOR
  }

  opts.lt = opts.gt + '\xff'
  return opts
}

exports.indexedProps = {
  object: getIndexedObjectProps,
  watch: getIndexedWatchProps,
  seal: getIndexedSealProps,
  // tx: getIndexedTxProps
}

exports.batchers = {
  object: getObjectBatch,
  seal: getIndexBatch,
  watch: getIndexBatch,
  // tx: getTxBatch
}

exports.indexKey = {
  object: getObjectIndexKey,
  seal: defaultGetIndexKey,
  watch: defaultGetIndexKey,
  // tx: getTxIndexKey
}

exports.indexMap = {
  object: defaultGetIndexMap,
  seal: defaultGetIndexMap,
  watch: defaultGetIndexMap,
  // tx: getTxIndexMap
}

exports.indexers = {}
;['object', 'seal', 'watch' /*, 'tx'*/].forEach(docType => {
  exports.indexers[docType] = indexer(
    exports.batchers[docType],
    exports.indexKey[docType],
    exports.indexMap[docType],
    exports.indexedProps[docType]
  )
})

// exports.search = searchIndex
// exports.first = firstFromIndex
// exports.indexStream = createIndexStream

// exports.getIndexKey = {
//   object: getObjectIndexKey,
//   seal: defaultGetIndexKey,
//   watch: defaultGetIndexKey
// }

function getObjectIndexKey (state, prop) {
  // permalink not uid, as uid will be different
  // for the next version of the object
  // return [prop, state[prop], uid].join(SEPARATOR)
  if (!state.permalink) throw new Error('missing "permalink"')

  return [prop, state[prop], state.permalink].join(SEPARATOR)
}

// function getTxIndexKey (state, prop) {
//   // state.uid === state.txId
//   return [prop, state[prop], state.uid].join(SEPARATOR)
// }

function indexer (getBatch, getIndexKey, getIndexMap, getIndexedProps) {
  return function (main, index) {
    const opts = {
      main,
      index,
      getIndexKey,
      getIndexMap,
      getIndexedProps
    }

    function first (prop, value, cb) {
      search(prop, value, function (err, results) {
        if (!err && !results.length) {
          err = new levelErrors.NotFoundError()
        }

        cb(err, results[0])
      })
    }

    function search (prop, value, opts, cb) {
      if (typeof opts === 'function') {
        cb = opts
        opts = null
      }

      return collect(createIndexStream(prop, value, opts), cb)
    }

    // function list (prop, value, opts) {
    // }

    function createIndexStream (prop, value, opts) {
      opts = opts || {}
      opts.keys = opts.values = true
      utils.extend(opts, getRangeOpts(prop, value))

      // default to live
      const source = opts.live === false ? index : index.live
      const pipeline = [
        // any index
        source.createReadStream(opts),
        through.obj(function (data, enc, cb) {
          if (data.type === 'del') cb()
          else cb(null, data.value) // figure out how to make it store utf8
        }),
        getEntry()
      ]

      return pump.apply(null, pipeline)
    }

    function getEntry () {
      return through.obj(function (uid, enc, cb) {
        main.get(uid.toString(), cb)
      })
    }

    return {
      batch: function (oldState, newState) {
        const batch = getBatch(oldState, newState, opts)
        return batch && utils.encodeBatch(batch)
      },
      createIndexStream,
      search,
      // list,
      first
    }
  }
}

// function getTxBatch (oldState, newState, opts) {
//   return getIndexBatch(oldState, newState, opts)
// }

function getObjectBatch (oldState, newState, opts) {
  const batch = getIndexBatch(oldState, newState, opts)
  batch.push({
    type: 'put',
    db: opts.main,
    key: (newState || oldState).permalink,
    value: (newState || oldState).uid
  })

  return batch
}

function getIndexBatch (oldState, newState, opts) {
  const kill = !newState

  newState = newState || {}
  oldState = oldState || {}

  const uid = newState.uid || oldState.uid
  const main = opts.main
  const index = opts.index
  const oldMap = opts.getIndexMap(oldState, opts)
  const newMap = opts.getIndexMap(newState, opts)
  const batch = []
  for (var k in newMap) {
    if (k in oldMap) {
      // ignore what didn't change
      delete newMap[k]
    }
  }

  for (var k in oldMap) {
    batch.push({
      type: 'del',
      db: index,
      key: k
    })
  }

  for (var k in newMap) {
    let v = newMap[k]
    batch.push({
      type: v == null ? 'del' : 'put',
      db: index,
      key: k,
      value: v
    })
  }

  batch.push({
    type: kill ? 'del' : 'put',
    db: main,
    key: uid,
    value: newState
  })

  return batch
}

function defaultGetIndexKey (state, prop) {
  const val = state[prop]
  if (val != null && typeof val !== 'object') {
    return [prop, state[prop], state.uid].join(SEPARATOR)
  }
}

function defaultGetIndexMap (state, opts) {
  const map = {}
  opts.getIndexedProps(state).forEach(function (prop) {
    // ignore compound props
    if (prop.indexOf('.') !== -1 || typeof state[prop] === 'undefined') return

    const key = opts.getIndexKey(state, prop)
    if (key) map[key] = state.uid
  })

  return map
}

// function getTxIndexMap (state, opts) {
//   const map = opts.getIndexKey(state, opts)
//   const addrs = state.to.addresses
//   addrs.forEach(function (addr, i) {
//     map[defaultGetIndexKey(addrs, i)] = state.uid
//   })

//   return map
// }
