
const leveldown = require('memdown')
const levelup = require('levelup')
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
