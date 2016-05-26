
const typeforce = require('typeforce')
const async = require('async')
const constants = require('./constants')
const utils = require('./utils')
const types = require('./types')
const MESSAGE_TYPE = require('./constants').TYPES.MESSAGE
const SIG = constants.SIG
const TYPE = constants.TYPE

module.exports = function validator (opts) {
  typeforce({
    node: typeforce.Object
  }, opts)

  const node = opts.node
  const middleware = []
  function use (fn, opts) {
    opts = opts || {}
    const type = opts.type
    const sync = opts.sync
    middleware.push(function typeFilter (wrapper, cb) {
      if (type && wrapper.object[TYPE] !== type) return cb()

      if (sync) {
        // pass result / error to cb
        utils.execAsync(() => fn(wrapper), cb)
      } else {
        fn(wrapper, cb)
      }
    })
  }

  function validate (wrapper, cb) {
    // utils.extend(node, wrapper, opts)
    utils.loadBG(node, wrapper, function (err, bg) {
      if (err) return cb(err)

      async.eachSeries(middleware, function iterator (fn, done) {
        fn(wrapper, done)
      }, cb)
    })
  }

  defaults.forEach(def => use(def.fn, def))

  return {
    use: use,
    validate: validate
  }
}

const defaults = exports.defaults = [
  { fn: utils.verifyAuthor, sync: true },
  { fn: utils.validateMessage, type: MESSAGE_TYPE, sync: true }
]
