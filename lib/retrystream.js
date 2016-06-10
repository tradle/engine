'use strict'

const createBackoff = require('backoff')
const through = require('through2')
const combine = require('stream-combiner2')
const typeforce = require('typeforce')
const DEFAULT_BACKOFF_OPTS = {
  initialDelay: 1000,
  maxDelay: 60000
}

/**
 * stream-based queue
 * @param  {[type]} opts [description]
 * @return {[type]}      [description]
 */
module.exports = exports = createRetryStream
// for ease of testing
module.exports.DEFAULT_BACKOFF_OPTS = DEFAULT_BACKOFF_OPTS

function createRetryStream (opts) {
  typeforce({
    primaryKey: typeforce.String,
    worker: typeforce.Function
  }, opts)

  // to support concurrency, use map-stream, but then you obviously lose order guarantees

  const worker = opts.worker
  const backoff = opts.backoff || createBackoff.exponential(exports.DEFAULT_BACKOFF_OPTS)

  const primaryKey = opts.primaryKey
  const inProgress = {}
  const registrar = through.obj(function jotDown (data, enc, cb) {
    const id = data[primaryKey]
    if (typeof id === 'undefined') throw new Error('invalid data, missing: ' + primaryKey)
    if (id in inProgress) return cb() // already queued

    inProgress[id] = true
    cb(null, data)
  })

  const processor = through.obj(function write (data, enc, cb) {
    ;(function loop () {
      if (!running) return // ignore
      if (paused) return transform.once('resume', loop)

      worker(data, function (err, val) {
        if (!running) return
        if (err) {
          // allow to skip the failed job
          if (!err.skip) {
            // or unshift back into stream
            backoff.once('ready', loop)
            return backoff.backoff()
          }
        }

        const id = data[primaryKey]
        delete inProgress[id]
        cb(null, {
          input: data,
          output: val
        })
      })
    })()
  })

  const transform = combine.obj(
    registrar,
    processor
  )

  let paused
  let running = true
  transform.on('pause', () => paused = true)
  transform.on('resume', () => paused = false)
  registrar.once('end', () => running = false)

  if (!transform.destroy) {
    transform.destroy = transform.end
  }

  return transform
}
