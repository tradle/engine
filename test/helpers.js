
const leveldown = require('memdown')
const utils = require('../lib/utils')
const changesFeed = require('../lib/changes')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
const IDENTITY_TYPE = constants.TYPES.IDENTITY
const helpers = exports
var dbCounter = 0

exports.nextDBName = function nextDBName () {
  return 'db' + (dbCounter++)
}

exports.nextFeed = function nextFeed () {
  return changesFeed(helpers.nextDB())
}

exports.nextDB = function nextDB () {
  return utils.levelup(helpers.nextDBName(), {
    db: leveldown
  })
}

exports.keeper = function keeper () {
  return helpers.nextDB()
}

exports.dummyIdentity = function (authorLink) {
  return {
    object: {
      [TYPE]: IDENTITY_TYPE,
      pubkeys: []
    },
    link: authorLink,
    permalink: authorLink
  }
}

process.on('uncaughtException', function (err) {
  if (err.tfError) console.log(err.tfError.stack)

  throw err
})
