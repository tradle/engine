/**
 * @module controls
 */

const EventEmitter = require('events').EventEmitter
const typeforce = require('@tradle/typeforce')
const {
  assert
} = require('./utils')

const controlOpts = typeforce.object({
  start: typeforce.Function,
  pause: typeforce.maybe(typeforce.Function)
})

/**
 * Start/stop/pause/resume controls with events.
 *
 * @param {Object}   opts - specify how the controls work
 * @param {Function} opts.start - template that starts the process, needs to return the stop function template
 * @param {Function} [opts.pause] - template to pause the process, needs to return the resume function
 * @returns {EventEmitter} An extended event emitter having a stop/start/pause/resume property
 */
module.exports = function controls (opts) {
  controlOpts.assert(opts)

  const ee = new EventEmitter()
  const stopped = {
    start (scope, args) {
      state = makeStarted(opts.start.apply(scope, args))
      scope.emit('start')
    },
    stop () {},
    pause () {
      throw new Error('can\'t pause while stopped, only when started')
    },
    resume () {
      throw new Error('can\'t resume while stopped, only when paused')
    },
    isRunning: false
  }

  let state = stopped

  return Object.assign(ee, {
    start () {
      return state.start(this, arguments)
    },
    stop () {
      return state.stop(this, arguments)
    },
    pause () {
      return state.pause(this, arguments)
    },
    resume () {
      // Resume needs to work without arguments!
      return state.resume(this)
    },
    isRunning: () => state.isRunning
  })

  function makeStarted (stop) { // eslint-disable-line func-style
    typeforce.Function.assert(stop)
    return {
      start () {},
      stop (scope, args) {
        state = stopped
        stop.apply(scope, args) // eslint-disable-line no-invalid-this
        scope.emit('stop')
      },
      pause (scope, args) {
        assert(opts.pause, 'no "pause" function provided')

        state = makePaused(state, opts.pause.apply(scope, args)) // eslint-disable-line no-invalid-this
        scope.emit('pause')
      },
      resume () {},
      isRunning: true
    }
  }

  function makePaused (started, resume) { // eslint-disable-line func-style
    typeforce.Function.assert(resume)
    return {
      start () {},
      stop (scope, args) {
        state.resume(scope)
        state.stop(scope, args)
      },
      pause () {},
      resume (scope) {
        resume.call(scope) // eslint-disable-line no-invalid-this
        state = started
        scope.emit('resume')
      },
      isRunning: false
    }
  }
}
