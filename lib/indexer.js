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
// const enumProps = ['sendstatus', 'sealstatus', 'watchstatus']

const indexedForObjectsOfType = {
  [MESSAGE]: ['sendstatus']
}

// TODO: sane enum design
// function getEnumValues (prop) {
//   return prop === 'sendstatus' ? utils.values(SendStatus) :
//     prop === 'sealstatus' ? utils.values(SealStatus) :
//     prop === 'watchstatus' ? utils.values(WatchStatus) : null
// }

function getIndexedProps (type) {
  typeforce(typeforce.String, type)
  const byType = indexedForObjectsOfType[type]
  return indexedForAllObjects.slice().concat(byType || [])
}

exports.getIndexedProps = getIndexedProps

exports.indexer = function indexer (main, index) {
  return {
    batch: getBatch
  }

  function getBatch (oldState, newState) {
    oldState = oldState || {}
    const uid = newState.uid
    const permalink = newState.permalink
    const getIndexKey = function (prop, state) {
      return [prop, state[prop], permalink].join(SEPARATOR)
    }

    const indexedProps = getIndexedProps(newState.type)
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

    // for (var prop in state) {
    //   var enumVals = getEnumValues(prop)
    //   if (!enumVals) continue

    //   var val = state[prop]
    //   enumVals.forEach(otherVal => {
    //     if (val !== otherVal) {
    //       batch.push({
    //         type: 'del',
    //         db: index,
    //         key: [prop, otherVal, permalink].join(SEPARATOR)
    //       })
    //     }
    //   })
    // }

    // don't delete, keep every version
    // if (changeVal.prevlink) {
    //   batch.push({
    //     type: 'del',
    //     db: main,
    //     key: utils.prevUID({
    //       prevlink: changeVal.prevlink,
    //       permalink: state.permalink
    //     })
    //   })
    // }

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

    return utils.encodeBatch(batch)
  }
}
