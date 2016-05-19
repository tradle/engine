
const TypedError = require('error/typed')
const constants = require('./constants')
const LINK = constants.LINK

exports.Exists = TypedError({
  type: 'exists',
  message: 'object {link} already exists',
  link: null
})
