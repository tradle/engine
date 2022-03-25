/**
 * log topics
 * @module topics
 */

const topics = {
  newobj: 'newobj',
  archiveobj: 'archiveobj',
  unarchiveobj: 'unarchiveobj',
  addcontact: 'addcontact',
  tx: 'tx',
  newwatch: 'newwatch',
  queueseal: 'queueseal',
  wroteseal: 'wroteseal',
  readseal: 'readseal',
  sent: 'sent',
  received: 'received',
  sendaborted: 'sendaborted',
  forget: 'forget'
}
topics.reverse = Object.entries(topics).reduce((result, [key, value]) => {
  result[value] = key
  return result
}, {})

module.exports = topics
