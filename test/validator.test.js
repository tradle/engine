require('./env')

const test = require('tape')
const validator = require('../lib/validator')
const utils = require('../lib/utils')
const constants = require('../lib/constants')
const TYPE = constants.TYPE
const SIG = constants.SIG
const contexts = require('./contexts')

test('validator', function (t) {
  contexts.twoFriendsSentReceived(function (err, context) {
    if (err) throw err

    const sender = context.sender
    const validate = validator(sender).validate
    const object = context.object
    const wrapper = context.sent
    validate({
      object: object,
      author: context.sender._recipientOpts
    }, { unique: true }, function (err) {
      t.equal(err.type, 'exists')

      let bad = utils.clone(wrapper)
      bad.author = { link: context.receiver.link }
      // change link to avoid ObjectExists error
      bad.link = 'heyho'
      validate(bad, { unique: true }, function (err) {
        t.equal(err.type, 'author')

        bad = utils.clone(wrapper)
        // change link to avoid ObjectExists error
        bad.link = 'heyho'
        const somethingElse = { [TYPE]: 'something', what: 'else' }
        sender.sign({ object: somethingElse }, function (err, result) {
          bad.object[SIG] = result.object[SIG]
          validate(bad, { unique: true }, function (err) {
            t.equal(err.type, 'invalidsignature')
            context.destroy()
            t.end()
          })
        })
      })
    })
  })
})
