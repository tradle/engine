'use strict'

const test = require('tape')
const backoff = require('backoff')
const createQueue = require('../lib/queue')

test('queue', function (t) {
  let jobsRunning = 0
  const jobs = [
    { tries: 2 },
    { tries: 5 },
    { tries: 1 },
    { tries: 4 }
  ].map(function (data, i) {
    data.timesExecuted = 0
    return {
      id: i,
      data: data
    }
  })

  const total = jobs.reduce(function (sum, job) {
    return sum + job.data.tries
  }, 0)

  let timesQueued = 3
  t.plan(total + jobs.length * 3 * timesQueued)

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
    backoff: backoff.exponential({
      initialDelay: 10,
      maxDelay: 100
    })
  })

  jobs.forEach(function (job, idx) {
    // each job may be queued multiple times
    // but shouldn't be executed multiple times
    for (var i = 0; i < timesQueued; i++) {
      (function () {
        q.push(job.id, job.data, function (err, val) {
          t.equal(val, job.data)
          t.equal(job.data.tries, 0)
          t.equal(job.data.timesExecuted, 1)
        })
      })()
    }
  })
})
