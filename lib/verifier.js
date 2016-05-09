
// const protocol = require('@tradle/protocol')
// const Message = protocol.proto.schema.Message
const constants = require('@tradle/constants')
const PREV = constants.PREV
const utils = require('./utils')

module.exports = function verifier (opts) {
  utils.assert(typeof opts.lookupIdentity === 'function', 'expected function "lookupIdentity"')
  utils.assert(typeof opts.lookupObject === 'function', 'expected function "lookupObject"')

  const lookupIdentity = opts.lookupIdentity
  const lookupObject = opts.lookupObject

  function verifyAuthor (object, author, cb) {
    cb = utils.asyncify(cb)
    let signingKey = protocol.getSigningKey(object[SIG])
    if (!signingKey) return cb(new Error('bad signature'))

    // key encoding should really be recorded in each key in an identity
    signingKey.value = signingKey.value.toString('hex')
    const hasKey = from.identity.pubkeys.some(function (key) {
      for (let p in signingKey) {
        if (signingKey[p] !== key[p]) {
          return false
        }
      }

      return true
    })

    if (!hasKey) return cb(new Error('wrong author'))

    cb()
  }

  function verifyMessage (msg, sender, cb) {
    typeforce({
      object: typeforce.Object,
      sig: typeforce.Buffer,
    }, msg)

    // try {
    //   msg = Message.decode(msg)
    // } catch (err) {
    //   return cb(err)
    // }

    msg = {
      object: msg.object,
      [SIG]: msg.sig
    }

    const checks = {
      author: null,
      sender: null,
      prevVersion: null
    }

    verifyAuthor(msg, sender, function (err) {
      if (err) {
        checks.sender = err
        return done()
      }

      const object = msg.object
      const signingKey = protocol.getSigningKey(object[SIG])
      lookupIdentity(utils.hex(signingKey.value), function (err, identityInfo) {
        if (err) {
          checks.author = err
          return done()
        }

        verifyAuthor(object, identityInfo, function (err) {
          if (err) {
            checks.author = err
            return done()
          }

          if (!object[PREV]) return done()

          lookupObject(object[PREV], function (err, val) {
            // TODO: we don't have the object to validate against
            if (err) {
              checks.prevVersion = err
              return done()
            }

            try {
              protocol.validateSequence(object, {
                prevVersion: val.object
              })
            } catch (err) {
              checks.prevVersion = err
              return done()
            }

            done()
          })
        })
      })
    })

    function done () {
      cb(null, checks)
    }
  }

  return {
    verifyAuthor: verifyAuthor,
    verifyMessage: verifyMessage
  }
}
