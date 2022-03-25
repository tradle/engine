/** @module msgMetaDB */

const typeforce = require('@tradle/typeforce')
const topics = require('../topics')
const utils = require('../utils')
const constants = require('../constants')
const MESSAGE_TYPE = constants.MESSAGE_TYPE

const createMsgMetaDbOpts = typeforce.object({
  node: typeforce.Object,
  db: typeforce.String,
  props: typeforce.Array,
  getProps: typeforce.maybe(typeforce.Function)
})

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
  createMsgMetaDbOpts.assert(opts)

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
