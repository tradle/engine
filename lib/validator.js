/**
 * @module validator
 */

const typeforce = require('./typeforce')
const async = require('async')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const utils = require('./utils')
const types = require('./types')
const errors = require('./errors')
const MESSAGE_TYPE = require('./constants').TYPES.MESSAGE
const PERMALINK = constants.PERMALINK
const PREVLINK = constants.PREVLINK
const SIG = constants.SIG
const TYPE = constants.TYPE

/**
 * message / object validation
 * @alias module:validator
 * @param  {node} node
 * @return {Object}
 */
module.exports = function validator (node) {
  return {
    validate,
    checkExists,
    checkPrev,
    checkAuthentic
  }

  function validate (wrapper, opts, cb) {
    if (typeof opts === 'function') {
      cb = opts
      opts = {}
    }

    utils.addLinks(wrapper)
    const tasks = [
      done => utils.loadBG(node, wrapper, done)
    ]

    if (opts.unique) {
      tasks.unshift(done => checkExists(wrapper, done))
    }

    async.series(tasks, function (err) {
      if (err) return cb(err)

      try {
        checkPrev(wrapper)
      } catch (err) {
        return cb(err)
      }

      checkAuthentic(wrapper, cb)
    })
  }

  // function validate (wrapper, cb) {
  //   utils.addLinks(wrapper)

  //   const isMsg = wrapper.object[TYPE] === MESSAGE_TYPE
  //   node.objects.get(wrapper.link, function (err) {
  //     if (!err && isMsg) {
  //       return cb(new errors.ObjectExists({ link: wrapper.link }))
  //     }

  //     // utils.extend(node, wrapper, opts)
  //     utils.loadBG(node, wrapper, function (err) {
  //       if (err) return cb(err)

  //       const object = wrapper.object
  //       const sig = object[SIG]
  //       const link = wrapper.link
  //       let signingKey
  //       try {
  //         signingKey = utils.getSigPubKey(object)
  //       } catch (err) {
  //       }

  //       if (!signingKey) return cb(new errors.InvalidSignature({ sig }))

  //       if (!utils.hasPubKey(wrapper.author.object, signingKey)) {
  //         return cb(new errors.Author({
  //           author: wrapper.author.link,
  //           sig: sig
  //         }))
  //       }

  //       if (isMsg) {
  //         try {
  //           // TODO: msg.prev
  //           protocol.validateMessage({ object })
  //         } catch (err) {
  //           return cb(err)
  //         }
  //       }

  //       cb()
  //     })
  //   })
  // }

  function checkExists (wrapper, cb) {
    node.objects.get({ link: wrapper.link, body: false }, function (err) {
      cb(err ? null : new errors.ObjectExists({ link: wrapper.link }))
    })
  }

  function checkPrev (wrapper) {
    const object = wrapper.object
    const prev = wrapper.prev
    // we may not have the previous version in our db
    if (!object[PREVLINK] || !prev) return

    if (prev.author !== wrapper.author.permalink) {
      throw new errors.InvalidVersion({
        error: 'prev version has a different author'
      })
    }

    try {
      protocol.validateVersioning({
        object,
        prev: prev.object,
        orig: object[PERMALINK]
      })
    } catch (err) {
      throw new errors.InvalidVersion({
        error: err.message
      })
    }

    if (prev[PERMALINK] && prev[PERMALINK] !== object[PERMALINK]) {
      throw new errors.InvalidVersion({
        error: `prev version has a different ${PERMALINK}`
      })
    }
  }

  function checkAuthentic (wrapper, cb) {
    const object = wrapper.object
    const sig = object[SIG]
    const link = wrapper.link
    utils.extractSigPubKey(object, function (err, signingKey) {
      if (err || !signingKey) return cb(new errors.InvalidSignature({ sig }))

      const pubKey = utils.findPubKey(wrapper.author.object, signingKey)
      if (!pubKey) {
        return cb(new errors.Author({
          author: wrapper.author.link,
          sig: sig
        }))
      }

      const expectedPurpose = object[TYPE] === constants.TYPES.IDENTITY ? 'update' : 'sign'
      if (pubKey.purpose !== expectedPurpose) {
        return cb(new errors.InvalidSignature({ sig, reason: 'wrong signing key was used' }))
      }

      cb()
    })
  }
}
