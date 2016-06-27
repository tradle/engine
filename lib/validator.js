'use strict'

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

module.exports = function validator (node) {
  return {
    validate,
    checkExists,
    checkPrev,
    checkAuthentic
  }

  function checkExists (wrapper, cb) {
    // duplicate non-message objects are ok
    if (wrapper.object[TYPE] !== MESSAGE_TYPE) return cb()

    node.objects.get(wrapper.link, function (err) {
      cb(err ? null : new errors.ObjectExists({ link: wrapper.link }))
    })
  }

  function validate (wrapper, cb) {
    utils.addLinks(wrapper)
    async.series([
      done => checkExists(wrapper, done),
      done => utils.loadBG(node, wrapper, done),
    ], function (err) {
      if (err) return cb(err)

      try {
        checkPrev(wrapper)
        checkAuthentic(wrapper)
        if (wrapper.object[TYPE] === MESSAGE_TYPE) {
          protocol.validateMessage({ object: wrapper.object })
        }
      } catch (err) {
        return cb(err)
      }

      cb()
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

  function checkPrev (wrapper) {
    const object = wrapper.object
    if (!object[PREVLINK]) return

    const prev = wrapper.prev
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

  function checkAuthentic (wrapper) {
    const object = wrapper.object
    const sig = object[SIG]
    const link = wrapper.link
    let signingKey
    try {
      signingKey = protocol.sigPubKey({ object })
    } catch (err) {
    }

    if (!signingKey) throw new errors.InvalidSignature({ sig })

    if (!utils.hasPubKey(wrapper.author.object, signingKey)) {
      throw new errors.Author({
        author: wrapper.author.link,
        sig: sig
      })
    }
  }
}
