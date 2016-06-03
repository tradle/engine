'use strict'

const typeforce = require('typeforce')
const utils = require('./utils')
// const noop = () => {}

module.exports = function controls (opts) {
  typeforce({
    start: typeforce.Function,
    pause: typeforce.maybe(typeforce.Function)
  }, opts)

  let _start = opts.start
  let _pause = opts.pause
  let _stop
  let _resume

  function start () {
    if (_stop) return

    _stop = _start.apply(this, arguments)
    typeforce(typeforce.Function, _stop)
  }

  function stop () {
    if (!_stop) return // already stopped

    // prevent race condition
    const tmp = _stop
    _stop = null
    _resume = function () {
      assert(false, 'can\'t resume when stopped, only when paused')
    }

    return tmp.apply(this, arguments)
  }

  function pause () {
    utils.assert(isRunning(), 'can\'t pause before start')
    utils.assert(_pause, 'no "pause" function provided')
    if (_resume) return // already resumed

    _resume = _pause.apply(this, arguments)
    typeforce(typeforce.Function, _resume)
  }

  function resume () {
    if (!_resume) return

    // prevent race condition
    const tmp = _resume
    _resume = null
    return tmp.apply(this, arguments)
  }

  function isRunning () {
    return _stop && !_resume
  }

  return {
    start,
    stop,
    pause,
    resume,
    isRunning
  }
}

