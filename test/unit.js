'use strict'

const test = require('tape')
const backoff = require('backoff')
const memdown = require('memdown')
const Readable = require('readable-stream').Readable
const indexFeed = require('../lib/index-feed')
const createQueue = require('../lib/queue')
const utils = require('../lib/utils')

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

  const q = createQueue({
    worker: worker,
    uniqueProperty: 'id',
    backoff: backoff.exponential({
      initialDelay: 10,
      maxDelay: 100
    })
  })

  let expectedNext = 0
  const input = new Readable({ objectMode: true })
  input._read = function () {}
  input.pipe(q).on('data', function (data) {
    t.equal(data.id, expectedNext++)
    t.equal(data.tries, 0)
    t.equal(data.timesExecuted, 1)
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

//   const q = createQueue({
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

// test.only('index-feed', function (t) {
//   const ixf = indexFeed({
//     leveldown: memdown,
//     index: './index',
//     log: './log',
//     indexer: indexer
//   })

//   function indexer (op, cb) {
//     cb(null, [{
//       type: 'put',
//       key: 'hey',
//       value: { hey: 'ho' }
//     }])
//   }

//   ixf.put('blah', 'habla', err => {
//     if (err) throw err

//     ixf.get('hey', (err, val) => {
//       if (err) throw err

//       t.same(val, {hey: 'ho'})
//       t.end()
//     })
//   })
// })
