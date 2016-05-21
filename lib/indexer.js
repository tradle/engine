'use strict'

const typeforce = require('typeforce')
const deepEquals = require('deep-equal')
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

function getIndexedObjectProps (oldState, newState) {
  typeforce({
    type: typeforce.String
  }, oldState)

  const type = oldState.type
  const byType = indexedForObjectsOfType[type]
  return indexedForAllObjects.slice().concat(byType || [])
}

function getIndexedSealProps () {
  return ['sealstatus']
}

function getIndexedWatchProps () {
  return ['watchstatus']
}

exports.indexedProps = {
  object: getIndexedObjectProps,
  watch: getIndexedWatchProps,
  seal: getIndexedSealProps
}

exports.indexers = {
  object: indexer(getObjectBatch, getObjectIndexKey, getIndexedObjectProps),
  seal: indexer(getSealBatch, getDefaultIndexKey, getIndexedSealProps),
  watch: indexer(getWatchBatch, getDefaultIndexKey, getIndexedWatchProps)
}

// exports.getIndexKey = {
//   object: getObjectIndexKey,
//   seal: getDefaultIndexKey,
//   watch: getDefaultIndexKey
// }

function getObjectIndexKey (state, prop) {
  // permalink not uid, as uid will be different
  // for the next version of the object
  // return [prop, state[prop], uid].join(SEPARATOR)
  if (!state.permalink) throw new Error('missing "permalink"')

  return [prop, state[prop], state.permalink].join(SEPARATOR)
}

function indexer (getBatch, getIndexKey, getIndexedProps) {
  return function (main, index) {
    const opts = {
      main,
      index,
      getIndexKey,
      getIndexedProps
    }

    return function (oldState, newState) {
      return getBatch(oldState, newState, opts)
    }
  }
}

function getWatchBatch (oldState, newState, opts) {
  return getIndexBatch(oldState, newState, opts)
}

function getSealBatch (oldState, newState, opts) {
  return getIndexBatch(oldState, newState, opts)
}

function getObjectBatch (oldState, newState, opts) {
  const batch = getIndexBatch(oldState, newState, opts)
  batch.push({
    type: 'put',
    db: opts.main,
    key: newState.permalink,
    value: newState.uid
  })

  return batch
}

// function getWatchBatch (oldState, newState, opts) {
//   const batch = getIndexBatch(oldState, newState, opts)

//   batch.push({
//     type: 'put',
//     key: newState.uid,
//     value: newState
//   })

//   return batch
// }

// function getSealBatch (main, index, oldState, newState) {
//   oldState = oldState || {}
//   const uid = newState.uid
//   const indexedProps = getIndexedSealProps(newState)
//   const getIndexKey = getDefaultIndexKey
//   const batch = []
//   indexedProps.forEach(prop => {
//     if (deepEquals(newState[prop], oldState[prop])) {
//       return
//     }

//     if (prop in oldState) {
//       batch.push({
//         type: 'del',
//         db: index,
//         key: getIndexKey(oldState, prop)
//       })
//     }

//     if (prop in newState) {
//       batch.push({
//         type: 'put',
//         db: index,
//         key: getIndexKey(newState, prop),
//         value: uid
//       })
//     }
//   })

//   batch.push({
//     type: 'put',
//     db: main,
//     key: newState.uid,
//     value: newState
//   })

//   return batch
// }

// function getObjectBatch (main, index, oldState, newState) {
//   oldState = oldState || {}

//   const uid = newState.uid
//   const permalink = newState.permalink
//   const indexedProps = getIndexedObjectProps(newState.type)
//   const batch = []
//   const getIndexKey = getObjectIndexKey
//   indexedProps.forEach(prop => {
//     if (deepEquals(newState[prop], oldState[prop])) {
//       return
//     }

//     if (prop in oldState) {
//       batch.push({
//         type: 'del',
//         db: index,
//         key: getIndexKey(oldState, prop)
//       })
//     }

//     if (prop in newState) {
//       batch.push({
//         type: 'put',
//         db: index,
//         key: getIndexKey(newState, prop),
//         value: uid
//       })
//     }
//   })

//   batch.push({
//     type: 'put',
//     db: main,
//     key: uid,
//     value: newState
//   })

//   // allow lookup of latest version by permalink
//   batch.push({
//     type: 'put',
//     db: main,
//     key: permalink,
//     value: uid
//   })

//   return batch
// }

function getIndexBatch (oldState, newState, opts) {
  oldState = oldState || {}
  const uid = newState.uid
  const main = opts.main
  const index = opts.index
  const indexedProps = opts.getIndexedProps(newState)
  const getIndexKey = opts.getIndexKey
  const batch = []
  indexedProps.forEach(prop => {
    if (deepEquals(newState[prop], oldState[prop])) {
      return
    }

    if (prop in oldState) {
      batch.push({
        type: 'del',
        db: index,
        key: getIndexKey(oldState, prop)
      })
    }

    if (prop in newState) {
      batch.push({
        type: 'put',
        db: index,
        key: getIndexKey(newState, prop),
        value: uid
      })
    }
  })

  batch.push({
    type: 'put',
    db: main,
    key: uid,
    value: newState
  })

  return batch
}

function getDefaultIndexKey (state, prop) {
  return [prop, state[prop], state.uid].join(SEPARATOR)
}
