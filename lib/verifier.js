
const protocol = require('@tradle/protocol')
// const Message = protocol.proto.schema.Message
const constants = require('@tradle/constants')
const PREV = constants.PREV
const utils = require('./utils')

const errors = {
  messageAuthor: function (err) {
    err.type = 'MessageAuthor'
    err.message = 'message author verification failed: ' + err.message
    return err
  },
  objectAuthor: function (err) {
    err.type = 'ObjectAuthor',
    err.message = 'object author verification failed: ' + err.message
    return err
  },
  version: function (err) {
    err.type = 'Version'
    err.message = 'version verification failed: ' + err.message
    return err
  }
}

module.exports = verifier
exports.errors = errors

function verifier (opts) {
  utils.assert(typeof opts.lookupIdentity === 'function', 'expected function "lookupIdentity"')
  utils.assert(typeof opts.lookupObject === 'function', 'expected function "lookupObject"')

  const lookupIdentity = opts.lookupIdentity
  const lookupObject = opts.lookupObject

  function verifyAuthor (object, author) {
    let signingKey = protocol.sigPubKey(object[SIG])
    if (!signingKey) throw new Error('bad signature')

    // key encoding should really be recorded in each key in an identity
    signingKey.value = utils.hex(signingKey.value)
    const hasKey = from.identity.pubkeys.some(function (key) {
      for (let p in signingKey) {
        if (signingKey[p] !== key[p]) {
          return false
        }
      }

      return true
    })

    if (!hasKey) throw new Error('wrong author')
  }

  function verifyMessage (msg, sender, cb) {
    // verify message author
    cb = utils.asyncify(cb)
    try {
      verifyAuthor(msg, sender)
    } catch (err) {
      return cb(errors.messageAuthor(err))
    }

    const object = msg.object
    const signingKey = protocol.sigPubKey(object[SIG])
    // lookup object author
    lookupIdentity(utils.hex(signingKey.value), function (err, identityInfo) {
      if (err) return cb(errors.objectAuthor(err))

      // verify object author
      try {
        verifyAuthor(object, identityInfo)
      } catch (err) {
        return cb(errors.objectAuthor(err))
      }

      if (!object[PREV]) return cb()

      // lookup previous version
      lookupObject(object[PREV], function (err, val) {
        // TODO: we don't have the object to validate against
        if (err) return cb(errors.version(err))

        try {
          protocol.validateSequence(object, {
            prevVersion: val.object
          })
        } catch (err) {
          return cb(errors.version(err))
        }

        cb()
      })
    })
  }

  return {
    verifyAuthor: verifyAuthor,
    verifyMessage: verifyMessage
  }
}
