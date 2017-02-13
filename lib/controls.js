/**
 * @module controls
 */

const EventEmitter = require('events').EventEmitter
const typeforce = require('./typeforce')
const {
  assert,
  extend
} = require('./utils')
// const noop = () => {}

/**
 * start/stop/pause/resume controls
 * @alias: module controls
 * @typedef {controls}
 * @param {function} start
 * @param {function} [pause]
 */
module.exports = function controls (opts) {
  typeforce({
    start: typeforce.Function,
    pause: typeforce.maybe(typeforce.Function)
  }, opts)

  let _start = opts.start
  let _pause = opts.pause
  let _stop
  let _resume
  const ee = new EventEmitter()

  function start () {
    if (_stop) return

    _stop = _start.apply(this, arguments)
    typeforce(typeforce.Function, _stop)
    ee.emit('start')
  }

  function stop () {
    if (!_stop) return // already stopped

    // prevent race condition
    const tmp = _stop
    _stop = null
    _resume = function () {
      assert(false, 'can\'t resume when stopped, only when paused')
    }

    tmp.apply(this, arguments)
    ee.emit('stop')
  }

  function pause () {
    if (_resume) return // already resumed

    assert(isRunning(), 'can\'t pause before start')
    assert(_pause, 'no "pause" function provided')

    _resume = _pause.apply(this, arguments)
    typeforce(typeforce.Function, _resume)
    ee.emit('pause')
  }

  function resume () {
    if (!_resume) return

    // prevent race condition
    const tmp = _resume
    _resume = null
    tmp.apply(this, arguments)
    ee.emit('resume')
  }

  function isRunning () {
    return !!(_stop && !_resume)
  }

  return extend(ee, {
    start,
    stop,
    pause,
    resume,
    isRunning
  })
}
