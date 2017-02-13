/** @module msgMetaDB */

const EventEmitter = require('events').EventEmitter
const pump = require('pump')
const through = require('through2')
const indexer = require('feed-indexer')
const typeforce = require('../typeforce')
const topics = require('../topics')
const types = require('../types')
const utils = require('../utils')
const constants = require('../constants')
const TYPE = constants.TYPE
const MESSAGE_TYPE = constants.MESSAGE_TYPE
const ENTRY_PROP = constants.ENTRY_PROP

/**
 * @typedef {Object} msgMetaDB
 */

/**
 * blockchain seals database, bootstrapped from log
 *
 * @alias module:msgMetaDB
 * @param  {Object} opts
 * @param  {Object} opts.changes  changes-feed
 * @param  {Object} opts.keeper   keeper
 * @param  {Object} opts.db       database to use to track message context
 */
module.exports = function createMsgMetaDB (opts) {
  typeforce({
    node: typeforce.Object,
    db: typeforce.String,
    props: typeforce.Array,
    getProps: typeforce.maybe(typeforce.Function)
  }, opts)

  const { node, props, getProps=pickProps } = opts
  const customIndexOpts = utils.extend({ preprocess, getProps }, opts)
  return node.customIndexes(customIndexOpts)

  function preprocess (change, cb) {
    const val = change.value
    if (val.type !== MESSAGE_TYPE || change.value.topic !== topics.newobj) return cb()

    node.keeper.get(val.permalink, function (err, body) {
      if (err) return cb(null, change)

      val.object = body
      cb(null, change)
    })
  }

  function pickProps (val) {
    return utils.pick(val.object, props)
  }
}
