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
    utils.addLinks(wrapper)

    node.objects.get(wrapper.link, function (err) {
      if (!err) return cb(new errors.ObjectExists(wrapper))

      // utils.extend(node, wrapper, opts)
      utils.loadBG(node, wrapper, function (err) {
        if (err) return cb(err)

        const object = wrapper.object
        const sig = object[SIG]
        const link = wrapper.link
        const signingKey = utils.getSigPubKey(object)
        if (!signingKey) {
          return cb(new errors.InvalidSignature({ sig }))
        }

        if (!utils.hasPubKey(wrapper.author.object, signingKey)) {
          return cb(new errors.Author({
            author: wrapper.author.link,
            sig: sig
          }))
        }

        if (object[TYPE] === MESSAGE_TYPE) {
          try {
            // TODO: msg.prev
            protocol.validateMessage({ object })
          } catch (err) {
            return cb(err)
          }
        }

        cb()
      })
    })
  }
}
