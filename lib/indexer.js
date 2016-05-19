
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

exports.indexer = function (main, index) {
  return {
    batch: getBatch
  }

  function getBatch (main, index, state, change) {
    const uid = state.uid
    const link = state.link
    const permalink = state.permalink
    const indexedProps = getIndexedProps(state.type)
    const batch = indexedProps.map(prop => {
      if (!(prop in state)) return

      return {
        type: 'put',
        db: index,
        key: [prop, state[prop], permalink].join(SEPARATOR),
        value: permalink
      }
    })
    .filter(row => row)

    for (var prop in change) {
      const enumVals = getEnumValues(prop)
      if (!enumVals) continue

      const val = change[prop]
      enumVals.forEach(otherVal => {
        if (val !== otherVal) {
          batch.push({
            type: 'del',
            db: index,
            key: [p, val, uid].join(SEPARATOR)
          })
        }
      })
    }

    batch.push({
      type: 'put',
      db: main,
      key: uid,
      value: state
    })

    return utils.encodeBatch(batch)
  }
}
