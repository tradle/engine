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

function getIndexedObjectProps (type) {
  typeforce(typeforce.String, type)
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
  object: indexer(getObjectBatch),
  seal: indexer(getSealBatch),
  watch: indexer(getWatchBatch)
}

function indexer (getBatch) {
  return function (main, index) {
    return getBatch.bind(null, main, index)
  }
}

function getWatchBatch (main, index, oldState, newState) {
  const batch = []

  batch.push({
    type: 'put',
    key: newState.uid,
    value: newState
  })

  return batch
}

function getSealBatch (main, index, oldState, newState) {
  oldState = oldState || {}
  const uid = newState.uid
  const getIndexKey = function (prop, state) {
    return [prop, state[prop], uid].join(SEPARATOR)
  }

  const indexedProps = getIndexedSealProps(newState)
  const batch = []
  indexedProps.forEach(prop => {
    if (deepEquals(newState[prop], oldState[prop])) {
      return
    }

    if (prop in oldState) {
      batch.push({
        type: 'del',
        db: index,
        key: getIndexKey(prop, oldState)
      })
    }

    if (prop in newState) {
      batch.push({
        type: 'put',
        db: index,
        key: getIndexKey(prop, newState),
        value: uid
      })
    }
  })

  batch.push({
    type: 'put',
    db: main,
    key: newState.uid,
    value: newState
  })

  return batch
}

function getObjectBatch (main, index, oldState, newState) {
  oldState = oldState || {}

  const uid = newState.uid
  const permalink = newState.permalink
  const getIndexKey = function (prop, state) {
    // permalink not uid, as uid will be different
    // for the next version of the object
    // return [prop, state[prop], uid].join(SEPARATOR)
    return [prop, state[prop], permalink].join(SEPARATOR)
  }

  const indexedProps = getIndexedObjectProps(newState.type)
  const batch = []
  indexedProps.forEach(prop => {
    if (deepEquals(newState[prop], oldState[prop])) {
      return
    }

    if (prop in oldState) {
      batch.push({
        type: 'del',
        db: index,
        key: getIndexKey(prop, oldState)
      })
    }

    if (prop in newState) {
      batch.push({
        type: 'put',
        db: index,
        key: getIndexKey(prop, newState),
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

  // allow lookup of latest version by permalink
  batch.push({
    type: 'put',
    db: main,
    key: permalink,
    value: uid
  })

  return batch
}
