'use strict'

const typeforce = require('typeforce')
const async = require('async')
const protocol = require('@tradle/protocol')
const constants = require('./constants')
const utils = require('./utils')
const types = require('./types')
const errors = require('./errors')
const MESSAGE_TYPE = require('./constants').TYPES.MESSAGE
const SIG = constants.SIG
const TYPE = constants.TYPE

module.exports = function validator (node) {
  return { validate}

  function validate (wrapper, cb) {
    // utils.extend(node, wrapper, opts)
    utils.loadBG(node, wrapper, function (err) {
      if (err) return cb(err)

      const sig = wrapper.object[SIG]
      const link = wrapper.link
      const signingKey = utils.getSigPubKey(wrapper.object)
      if (!signingKey) {
        return cb(new errors.InvalidSignature({ sig }))
      }

      if (!utils.hasPubKey(wrapper.author.object, signingKey)) {
        return cb(new errors.Author({
          author: wrapper.author.link,
          sig: sig
        }))
      }

      if (wrapper.object[TYPE] === MESSAGE_TYPE) {
        try {
          protocol.validateMessage({
            message: wrapper.object,
            // TODO: msg.prev
          })
        } catch (err) {
          return cb(err)
        }
      }

      cb()
    })
  }
}
