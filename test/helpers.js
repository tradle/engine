
const leveldown = require('memdown')
const levelup = require('levelup')
const utils = require('../lib/utils')
const changesFeed = require('../lib/changes')
const helpers = exports
var dbCounter = 0

exports.nextDBName = function nextDBName () {
  return 'db' + (dbCounter++)
}

exports.nextFeed = function nextFeed () {
  return changesFeed(helpers.nextDB())
}

exports.nextDB = function nextDB () {
  return levelup(helpers.nextDBName(), {
    db: leveldown,
    valueEncoding: 'json'
  })
}

exports.keeper = function keeper () {
  return helpers.nextDB()
}

process.on('uncaughtException', function (err) {
  if (err.tfError) console.log(err.tfError.stack)

  throw err
})
