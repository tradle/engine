
const typeforce = require('typeforce')
const utils = require('./utils')
const constants = require('./constants')
const statuses = require('./status')
const SealStatus = statuses.seal
const SendStatus = statuses.send
const WatchStatus = statuses.watch
const MESSAGE = constants.MESSAGE
const LINK = constants.LINK
const PERMALINK = constants.PERMALINK
const SEPARATOR = constants.INDEX_SEPARATOR

const indexedForAllObjects = [LINK, PERMALINK, 'sealstatus', 'type']
const enumProps = ['sendstatus', 'sealstatus', 'watchstatus']

const indexedForObjectsOfType = {
  [MESSAGE]: ['sendstatus']
}

// TODO: sane enum design
function getEnumValues (prop) {
  return prop === 'sendstatus' ? utils.values(SendStatus) :
    prop === 'sealstatus' ? utils.values(SealStatus) :
    prop === 'watchstatus' ? utils.values(WatchStatus) : null
}

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

  function getBatch (state, change) {
    const changeVal = change.value
    const uid = state.uid
    const permalink = state.permalink
    const indexedProps = getIndexedProps(state.type)
    const batch = indexedProps.map(prop => {
      if (!(prop in state)) return

      return {
        type: 'put',
        db: index,
        key: [prop, state[prop], permalink].join(SEPARATOR),
        value: uid
      }
    })
    .filter(row => row)

    for (var prop in changeVal) {
      const enumVals = getEnumValues(prop)
      if (!enumVals) continue

      const val = changeVal[prop]
      enumVals.forEach(otherVal => {
        if (val !== otherVal) {
          batch.push({
            type: 'del',
            db: index,
            key: [p, val, permalink].join(SEPARATOR)
          })
        }
      })
    }

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
      value: state
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
