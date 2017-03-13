const async = require('async')
const map = require('map-stream')
const pump = require('pump')
const collect = require('stream-collector')
const { flatten } = require('./utils')

module.exports = function forget ({ node, permalink }, cb) {
  const conversation = node.conversation({
    with: permalink,
    body: false
  })

  const stream = pump(
    conversation,
    forgetter(node)
  )

  collect(stream, function (err, arrays) {
    if (err) return cb(err)

    cb(null, flatten(arrays))
  })
}


function forgetter (node) {
  return map(function (message, done) {
    async.parallel([
      taskCB => forgetObject(message, taskCB),
      taskCB => maybeDeletePayloadObject(message, taskCB)
    ], function (err, results) {
      if (err) return done(err)

      results = results.filter(result => result)
      done(null, results)
    })
  })

  function maybeDeletePayloadObject (message, cb) {
    const { objectinfo } = message
    const { link, permalink } = objectinfo
    const stream = node.objects.messagesWithObject({
      permalink,
      link,
      body: false
    })

    collect(stream, function (err, messages) {
      if (err) return cb(err)

      const pointersLeft = messages.filter(m => {
        return m.permalink !== message.permalink
      })

      if (!pointersLeft.length) {
        return forgetObject(objectinfo, cb)
      }

      cb()
    })
  }

  function forgetObject (object, cb) {
    node.actions.forgetObject(object.link, function (err) {
      if (err) return cb(err)

      cb(null, object)
    })
  }
}
