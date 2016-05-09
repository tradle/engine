'use strict'

const createBackoff = require('backoff')
const mutexify = require('mutexify')

/**
 * queue with concurrency 1
 * @param  {[type]} opts [description]
 * @return {[type]}      [description]
 */
module.exports = function queue (opts) {
  if (typeof opts === 'function') {
    opts = { worker: opts }
  }

  const worker = opts.worker
  const backoff = opts.backoff || createBackoff.exponential({
    initialDelay: 1000,
    maxDelay: 60000
  })

  const nextID = 0
  const queued = {}
  const lock = mutexify()
  let destroyed
  return {
    push: function (id, data, cb) {
      if (destroyed) throw new Error('destroyed')

      if (typeof data === 'function') {
        cb = data
        data = id
        id = nextID++ & 0xffffffff
      }

      const alreadyQueued = !!queued[id]
      if (!alreadyQueued) queued[id] = []

      queued[id].push(cb)
      if (alreadyQueued) return

      lock(function (release) {
        if (destroyed) return release()

        ;(function loop () {
          worker(data, function (err, val) {
            if (err) {
              // allow to skip the failed job
              if (!err.skip) {
                backoff.once('ready', loop)
                return backoff.backoff()
              }
            }

            release(function (err, val) {
              const cbs = queued[id].slice()
              delete queued[id]
              cbs.forEach(function (fn) {
                fn(err, val)
              })
            }, null, val)
          })
        })()
      })
    },
    destroy: function () {
      destroyed = true
      backoff.reset()
    }
  }
}

function call (fn) {
  fn()
}
