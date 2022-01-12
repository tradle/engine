require('./env')

const test = require('tape')
const backoff = require('backoff')
const memdown = require('memdown')
const levelup = require('levelup')
const subdown = require('subleveldown')
const Readable = require('readable-stream').Readable
const collect = require('stream-collector')
const protocol = require('@tradle/protocol')
const controls = require('../lib/controls')
const createRetryStream = require('../lib/retrystream')
const utils = require('../lib/utils')
const network = require('@tradle/bitcoin-adapter').testnet
const Partial = require('../lib/partial')
const users = require('./fixtures/users')
const {
  TYPE,
  SIG,
  AUTHOR,
  VERSION,
  TIMESTAMP
} = require('../lib/constants')

test('merge streams', function (t) {
  t.plan(1)
  const a = new Readable({ objectMode: true })
  a._read = utils.noop
  const b = new Readable({ objectMode: true })
  b._read = utils.noop

  function compare (n, m) {
    return n - m
  }

  collect(utils.mergeStreams([a, b], compare), function (err, result) {
    if (err) throw err

    t.same(result, [0, 1, 2, 3, 4, 5])
  })

  a.push(4)
  b.push(1)
  a.push(2)
  b.push(0)
  a.push(5)
  a.push(null)
  b.push(3)
  b.push(null)
})

test('pub key to address', function (t) {
  const pub = Buffer.from('030135adc7e0be8429fc903511f2f72ea481b25f9177d9f2f3d2ecfcd81d1b02b4', 'hex')
  t.equal(network.pubKeyToAddress(pub), 'muZH3FNp1836Eyxc966NnfWwe79TnUhuFi')
  t.end()
})

// test('codecs', function (t) {
//   const top = levelup('top', {
//     db: memdown,
//     valueEncoding: 'json'
//   })

//   const utf8 = subdown(top, 'a', {
//     valueEncoding: 'utf8'
//   })

//   const binary = subdown(top, 'b', {
//     valueEncoding: 'binary'
//   })

//   const custom = subdown(top, 'c', {
//     valueEncoding: {
//       encode: function (value) {
//         return 'blah'
//       },
//       decode: function (value) {
//         return 'habla'
//       }
//     }
//   })

//   const rawBatch = [
//     {
//       type: 'put',
//       key: 'top',
//       value: 'json'
//     },
//     {
//       type: 'del',
//       key: 'utf8',
//       value: 'utf8',
//       db: utf8
//     },
//     {
//       type: 'put',
//       key: 'binary',
//       value: 'binary',
//       db: binary
//     },
//     {
//       type: 'put',
//       key: 'custom',
//       value: 'custom',
//       db: custom
//     }
//   ];

//   const encoded = utils.encodeBatch(rawBatch)
//   console.log(encoded)
//   t.end()
// })

test('queue', function (t) {
  let jobsRunning = 0
  const jobs = [
    { tries: 2 },
    { tries: 5 },
    { tries: 1 },
    { tries: 7 }
  ].map(function (data, i) {
    data.timesExecuted = 0
    data.id = i
    return data
  })

  const total = jobs.reduce(function (sum, job) {
    return sum + job.tries
  }, 0)

  let timesQueued = 3
  t.plan(total + jobs.length * 3)

  const worker = function (data, cb) {
    t.equal(jobsRunning++, 0)
    setTimeout(function () {
      jobsRunning--
      data.tries--
      if (data.tries < 0) throw new Error('too many tries')

      if (data.tries === 0) {
        data.timesExecuted++
        cb(null, data)
      }
      else {
        cb(new Error('boo'))
      }
    }, 10)
  }

  const q = createRetryStream({
    worker: worker,
    primaryKey: 'id',
    backoff: backoff.exponential({
      initialDelay: 10,
      maxDelay: 100
    })
  })

  let expectedNext = 0
  const input = new Readable({ objectMode: true })
  input._read = function () {}
  input.pipe(q).on('data', function (data) {
    t.equal(data.input.id, expectedNext++)
    t.equal(data.input.tries, 0)
    t.equal(data.input.timesExecuted, 1)
  })

  for (var i = 0; i < timesQueued; i++) {
    // test duplicates
    jobs.forEach(job => input.push(job))
  }

  // jobs.forEach(function (job, idx) {
  //   // each job may be queued multiple times
  //   // but shouldn't be executed multiple times
  //   for (var i = 0; i < timesQueued; i++) {
  //     (function () {
  //       q.push(job.id, job.data, function (err, val) {
  //         t.equal(val, job.data)
  //         t.equal(job.data.tries, 0)
  //         t.equal(job.data.timesExecuted, 1)
  //       })
  //     })()
  //   }
  // })
})

test('pause queue', function (t) {
  let paused
  const q = createRetryStream({
    worker: function (data, cb) {
      t.notOk(paused)

      setTimeout(() => {
        if (data.id === 'b') q.pause()
        if (data.id === 'e') t.end()

        cb()
      }, 100)
    },
    primaryKey: 'id',
    backoff: backoff.exponential({
      initialDelay: 10,
      maxDelay: 100
    })
  })

  q.on('pause', () => paused = true)
  q.on('resume', () => paused = false)
  q.write({ id: 'a' })
  q.write({ id: 'b' })
  q.write({ id: 'c' })
  q.write({ id: 'd' })
  q.write({ id: 'e' })
  setTimeout(() => q.resume(), 1000)
})

test('lockify', function (t) {
  t.timeoutAfter(1000)
  let running = 0

  const obj = {
    a: function a (n, cb) {
      t.equal(++running, 1)
      setTimeout(function () {
        cb(new Error('blah'))
      }, 100)
    },
    b: function b (n, cb) {
      t.equal(++running, 1)
      setTimeout(function () {
        cb(null, 'yay')
      }, 50)
    },
    // not locked
    c: function (n, cb) {
      setTimeout(cb, 20)
    }
  }

  utils.lockify(obj, ['a', 'b'])

  var done = {}
  obj.a('a', function (err) {
    --running
    t.equal(err.message, 'blah')
    t.notOk(done.a)
    t.notOk(done.b)
    done.a = true
  })

  obj.a('a', function (err) {
    --running
    t.equal(err.message, 'blah')
    t.ok(done.a)
  })

  obj.b('b', function (err, val) {
    t.error(err)
    --running
    t.ok(done.a)
    t.equal(val, 'yay')
    done.b = true
    t.end()
  })

  obj.c('c', function () {
    t.equal(Object.keys(done).length, 0)
  })
})

function last (arr) {
  const l = arr.length
  if (l === 0) {
    return null
  }
  return arr[l - 1]
}

test('controls', function (t) {
  let started = false
  let paused = false
  const events = []

  const c = controls({
    start (arg) {
      t.notOk(started)
      t.notOk(paused)
      t.equals(c, this)
      t.equals(arg, 'arg-start')
      const lastEvent = last(events)
      t.ok(lastEvent === null || lastEvent === 'stop')
      t.notEquals(last(events), 'start')
      started = true
      return function stop (stopArg) {
        t.equals(c, this) // eslint-disable-line no-invalid-this
        t.ok(started)
        t.equals(stopArg, 'arg-end')
        started = false
      }
    },
    pause (arg) {
      t.ok(started)
      t.notOk(paused)
      t.equals(c, this)
      t.equals(last(events), 'start')
      t.equals(arg, 'arg-pause')
      paused = true
      return function resume (resumeArg) {
        t.equals(c, this) // eslint-disable-line no-invalid-this
        t.equals(resumeArg, undefined) // eslint-disable-line no-undefined
        t.ok(started)
        t.ok(paused)
        t.equals(last(events), 'pause')
        paused = false
      }
    }
  })
    .on('start', () => events.push('start'))
    .on('pause', () => events.push('pause'))
    .on('resume', () => events.push('resume'))
    .on('stop', () => events.push('stop'))

  t.notOk(c.isRunning())
  t.throws(() => c.pause())
  t.throws(() => c.resume())

  c.start('arg-start')
  t.deepEquals(events, ['start'])
  t.ok(c.isRunning())
  c.pause('arg-pause')
  t.deepEquals(events, ['start', 'pause'])
  c.pause()
  t.deepEquals(events, ['start', 'pause'])
  t.notOk(c.isRunning())
  c.stop('arg-end')
  t.deepEquals(events, ['start', 'pause', 'resume', 'stop'])
  t.notOk(c.isRunning())
  t.throws(() => c.resume())

  c.start('arg-start')
  t.ok(c.isRunning())
  c.pause('arg-pause')
  c.resume('arg-resume')
  t.deepEquals(events, ['start', 'pause', 'resume', 'stop', 'start', 'pause', 'resume'])
  c.stop('arg-end')

  t.end()
})

test('controls without pause', function (t) {
  const c = controls({
    start () {
      return () => {}
    }
  })
  c.start()
  t.throws(() => c.pause())
  t.end()
})

test('controls when extending another instance', function (t) {
  const base = controls({
    start () {
      t.equals(this, c)
      return function stop () {
        t.equals(this, c) // eslint-disable-line no-invalid-this
      }
    },
    pause () {
      t.equals(this, c)
      return function resume () {
        t.equals(this, c) // eslint-disable-line no-invalid-this
      }
    }
  })
  const events = []
  const c = Object.assign({
    test: true,
    emit (event) {
      events.push(event)
    }
  }, base)
  t.ok(c.test)
  c.start()
  t.deepEquals(events, ['start'])
  c.pause()
  t.deepEquals(events, ['start', 'pause'])
  c.stop()
  t.deepEquals(events, ['start', 'pause', 'resume', 'stop'])
  t.end()
})

// test('identity serialization', function (t) {
//   users.slice(0, 1).forEach(u => {
//     const identity = u.identity
//     identity.pubkeys.forEach(function (p) {
//       const deserialized = utils.deserializePubKey(utils.serializePubKey(p))
//       t.same(deserialized, p)
//     })

//     const deserialized = utils.deserializeIdentity(utils.serializeIdentity(identity))
//     t.same(deserialized, identity)
//   })

//   t.end()
// })

test('partials', function (t) {
  const obj = protocol.object({
    object: {
      [TYPE]: 'tradle.Something',
      [AUTHOR]: 'bob',
      a: 1,
      b: {
        b1: 'hey'
      },
      c: {
        c1: {
          c11: 'ho'
        },
        c2: 4
      },
      d: true
    }
  })

  obj[SIG] = '...'
  const partialType = Partial
    .from(obj)
    .add({ property: TYPE, key: true, value: true })
    .build()

  t.equal(partialType.sig, obj[SIG])
  t.equal(Partial.verify(partialType), true)

  const partialA = Partial
    .from(obj)
    .add({ property: 'a', key: true, value: true })
    .build()

  t.equal(Partial.verify(partialA), true)

  partialType.leaves = partialA.leaves
  t.equal(Partial.verify(partialType), false)

  t.end()
})

// test('queue', function (t) {
//   let jobsRunning = 0
//   const jobs = [
//     { tries: 2 },
//     { tries: 5 },
//     { tries: 1 },
//     { tries: 4 }
//   ].map(function (data, i) {
//     data.timesExecuted = 0
//     return {
//       id: i,
//       data: data
//     }
//   })

//   const total = jobs.reduce(function (sum, job) {
//     return sum + job.data.tries
//   }, 0)

//   let timesQueued = 3
//   t.plan(total + jobs.length * 3 * timesQueued)

//   const worker = function (data, cb) {
//     t.equal(jobsRunning++, 0)
//     setTimeout(function () {
//       jobsRunning--
//       data.tries--
//       if (data.tries < 0) throw new Error('too many tries')

//       if (data.tries === 0) {
//         data.timesExecuted++
//         cb(null, data)
//       }
//       else {
//         cb(new Error('boo'))
//       }
//     }, 10)
//   }

//   const q = createRetryStream({
//     worker: worker,
//     backoff: backoff.exponential({
//       initialDelay: 10,
//       maxDelay: 100
//     })
//   })

//   jobs.forEach(function (job, idx) {
//     // each job may be queued multiple times
//     // but shouldn't be executed multiple times
//     for (var i = 0; i < timesQueued; i++) {
//       (function () {
//         q.push(job.id, job.data, function (err, val) {
//           t.equal(val, job.data)
//           t.equal(job.data.tries, 0)
//           t.equal(job.data.timesExecuted, 1)
//         })
//       })()
//     }
//   })
// })
