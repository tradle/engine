
'use strict'

const async = require('async')
const pump = require('pump')
const typeforce = require('typeforce')
const through = require('through2')
const subdown = require('subleveldown')
const debug = require('debug')('tradle:addressBook')
const protocol = require('@tradle/protocol')
const changeProcessor = require('level-change-processor')
const constants = require('../constants')
const PERMALINK = constants.PERMALINK
const LINK = constants.LINK
const PREVLINK = constants.PREVLINK
const utils = require('../utils')
const topics = require('../topics')
const types = require('../types')
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const LINK_PREFIX = 'c!'

module.exports = function createAddressBook (opts) {
  typeforce({
    changes: types.changes,
    db: types.db,
    keeper: types.keeper
  }, opts)

  const keeper = opts.keeper
  const db = opts.db
  const processor = changeProcessor({
    feed: opts.changes,
    db: subdown(db, '~'), // counter
    worker: worker
  })

  // processor.on('live', console.log.bind(console, 'live'))

  // secondary index map to current hash

  // TODO: move this to indexers
  const dbOpts = { valueEncoding: utils.defaultValueEncoding }
  const byPermalink = utils.live(subdown(db, 'r', dbOpts), processor)
  const index = utils.live(subdown(db, 's', dbOpts), processor)

  function worker (change, cb) {
    const val = change.value
    switch (val.topic) {
    case topics.addcontact:
      return addContact(change, cb)
    // case topics.setidentity:
    //   return setIdentity(change, cb)

    }

    cb()
  }

  // function setIdentity (change, cb) {
  //   const val = change.value
  //   const permalink = val[PERMALINK]
  //   const link = val[LINK]
  //   db.put()
  // }

  function addContact (change, cb) {
    const val = change.value
    const permalink = val.permalink
    const link = val.link

    keeper.get(link, function (err, identity) {
      if (err) return cb(err)

      let batch = identity.pubkeys.map(key => key.pub)
        .concat(identity.pubkeys.map(key => key.fingerprint))
        .concat(link)
        .map(v => {
          return {
            type: 'put',
            db: index,
            key: v,
            value: link
          }
        })

      const prevLink = identity[PREVLINK] || identity[PERMALINK]
      if (prevLink) {
        // delete previous link mapping
        batch.push({
          type: 'del',
          db: index,
          key: prevLink
        })
      }

      batch = utils.encodeBatch(batch)

      // prevent overwrite as overwrite implies
      // that two identities share keys
      async.parallel(batch.map(function (op) {
        return function (done) {
          db.get(op.key, function (err, val) {
            if (val && val !== permalink) {
              done(new Error('refusing to overwrite identity key mappings'))
            } else {
              done()
            }
          })
        }
      }), function commit (err) {
        if (err) {
          debug('experienced error saving identity', err, identity)
          return cb()
        }

        // so we can stream identities
        batch.push(utils.encodeRow({
          type: 'put',
          db: byPermalink,
          key: permalink,
          value: link
        }))

        // batch.push({
        //   type: 'put',
        //   key: utils.prefixKey(index, permalink),
        //   value: link
        // })

        db.batch(batch, cb)
      })
    })
  }

  function bySecondaryIndex (str, cb) {
    typeforce(typeforce.String, str)
    processor.onLive(function () {
      db.get(utils.prefixKey(index, str), function (err, val) {
        if (err) return cb(err)

        getBody(val, cb)
      })
    })
  }

  function getBody (link, cb) {
    typeforce(typeforce.String, link)
    keeper.get(link, function (err, body) {
      if (err) return cb(err)

      cb(null, formatidentityInfo(link, body))
    })
  }

  function formatidentityInfo (link, body) {
    return utils.addLinks({
      link: link,
      object: body
    })
  }

  function createReadStream (opts) {
    opts = opts || {}
    return pump(
      byPermalink.live.createReadStream({ keys: false }),
      through.obj(function (link, enc, cb) {
        getBody(link, cb)
      })
    )
  }

  return {
    _db: db,
    lookupIdentity: bySecondaryIndex,
    stream: createReadStream
  }
}

function prefixlink (val) {
  return LINK_PREFIX + val
}
