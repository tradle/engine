'use strict'

const Readable = require('readable-stream')
const pump = require('pump')
const through = require('through2')
const noop = function () {}

/**
 * inefficient stream merger (uses sort at the end instead of merge during)
 * @return {Readable}
 */
module.exports = function merge (streams, compare) {
  const arr = []
  const out = new Readable({ objectMode: true })
  out._read = noop
  let togo = streams.length
  streams.forEach(stream => {
    stream.on('end', done)
    stream.on('data', data => arr.push(data))
  })

  return out

  function done (cb) {
    if (--togo) return

    arr.sort(compare).forEach(out.push, out)
    out.push(null)
  }
}
