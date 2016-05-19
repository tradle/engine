const typeforce = require('typeforce')
const changesFeed = require('changes-feed')
const topics = require('./topics')
const utils = require('./utils')

module.exports = function feedWithTimestamp () {
  const feed = changesFeed.apply(null, arguments)
  const append = feed.append

  // sadly this is a monkeypatch and not a wrapper
  // as feed has some properties like `feed.change`
  // copying which ends up as ugly as monkeypatching
  feed.append = function (data, cb) {
    // disable in production mode
    validateEntry(data)

    data.timestamp = data.timestamp || utils.now()
    return append.call(feed, data, cb)
  }

  return feed
}

function validateEntry (entry) {
  switch (entry.topic) {
  case topics.queueseal:
    typeforce({
      sealID: typeforce.String,
      link: typeforce.String,
      basePubKey: types.chainPubKey,
      thisseal: types.chainPubKey,
      prevseal: typeforce.maybe(types.chainPubKey),
      amount: typeforce.Number
    }, entry)

    break
  case topics.addcontact:
    typeforce({
      link: typeforce.String,
      permalink: typeforce.String,
      prevlink: typeforce.maybe(typeforce.String)
    }, entry)

    break
  case topics.newobj:
    typeforce({
      uid: typeforce.String,
      link: typeforce.String,
      permalink: typeforce.String,
      prevlink: typeforce.maybe(typeforce.String),
      author: typeforce.String,
      type: typeforce.String
    }, entry)

    break
  case undefined:
    throw new Error('expected "topic"')
  }
}
