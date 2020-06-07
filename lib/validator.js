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
const {
  PERMALINK,
  PREVLINK,
  SIG,
  TYPE,
  AUTHOR
} = require('@tradle/constants')

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
    checkMore,
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
      checkMore(wrapper, cb)
      // try {
      //   checkPrev(wrapper, cb)
      // } catch (err2) {
      //   return cb(err2)
      // }

      // checkAuthentic(wrapper, cb)
    })
  }

  function checkExists (wrapper, cb) {
    node.objects.get({ link: wrapper.link, body: false }, function (err) {
      cb(err ? null : new errors.ObjectExists({ link: wrapper.link }))
    })
  }

  // function checkPrev (wrapper, cb) {
  function checkMore (wrapper, cb) {
    const object = wrapper.object
    const prev = wrapper.prev
    // we may not have the previous version in our db
    if (!object[PREVLINK] ||
        !prev             ||
        prev.author === wrapper.author.permalink) {
      checkAuthentic(wrapper, cb)
      return
    }
    debugger
    // Check if the object was submitted from user's another device
    let _masterAuthor = object._masterAuthor || object._author
    node.addressBook.lookupIdentity(_masterAuthor, (err, identity) => {
      if (err  ||  !identity) return cb(new errors.UnknownIdentity({
          error: 'prev version has a different author',
          value: {permalink: _masterAuthor}
        }))
      try {
        checkPrev(identity.object, object, prev)
      } catch (errPrev) {
        return cb(errPrev)
      }

      checkAuthentic(wrapper, cb)
    })
  }

  function checkPrev(masterIdentity, object, prev) {
    if (masterIdentity[PERMALINK] === prev.author)
      otherAuthor = masterIdentity
    else {
      otherAuthor = masterIdentity.pubkeys.find(pub => pub.importedFrom === prev.author)
      if (!otherAuthor) {
        throw new errors.InvalidVersion({
          error: 'prev version has a different author'
        })
      }
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
    const { object, link, author } = wrapper
    const sig = object[SIG]
    if (object[AUTHOR] !== author.permalink) {
      return cb(new errors.Author({
        author: object[AUTHOR],
        sig
      }))
    }

    utils.extractSigPubKey(object, function (err, signingKey) {
      if (err || !signingKey) return cb(new errors.InvalidSignature({ sig }))

      const pubKey = utils.findPubKey(wrapper.author.object, signingKey)
      if (!pubKey) {
        return cb(new errors.Author({
          author: author.permalink,
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

