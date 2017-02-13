/**
 * log topics
 * @module topics
 */

module.exports = exports = {
  newobj: 'newobj',
  archiveobj: 'archiveobj',
  unarchiveobj: 'unarchiveobj',
  // setidentity: 'setidentity',
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

exports.reverse = {}
for (let p in exports) {
  exports.reverse[exports[p]] = p
}
