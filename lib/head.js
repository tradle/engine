// Copyright (c) 2014 John Firebaugh
// https://github.com/jfirebaugh/node-take-stream

const Transform = require('readable-stream').Transform

module.exports = head

function head (n) {
  var count = 0
  var stream = new Transform({
    objectMode: true,
      highWaterMark: 2 // Should be 1 or 0 but https://github.com/joyent/node/issues/7364
  })

  if (n === 0) {
    stream.push(null)
  }

  stream._transform = function (chunk, encoding, callback) {
    if (++count <= n) {
      stream.push(chunk)
      callback()
    }

    if (count === n) {
      stream.push(null)
    }
  }

  return stream
}
