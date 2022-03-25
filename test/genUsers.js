#!/usr/bin/env node

const fs = require('fs')
const path = require('path')
const typeforce = require('@tradle/typeforce')
const { genUsers } = require('./helpers')
const argv = require('minimist')(process.argv.slice(2), {
  alias: {
    f: 'file',
    n: 'number'
  }
})

writeUsersFile(argv)
const writeUsersFileOpts = typeforce.compile({
  file: 'String',
  number: 'Number'
})

function writeUsersFile (opts) {
  writeUsersFileOpts.assert(opts)

  const { number, file } = opts
  genUsers(number, function (err, results) {
    if (err) throw err

    fs.writeFile(path.resolve(file), JSON.stringify(results, null, 2))
  })
}

