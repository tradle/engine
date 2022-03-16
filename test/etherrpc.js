#!/usr/bin/env node
const cp = require('child_process')
if (process.argv[2] === 'child') {
  startServer()
} else {
  startBgProcess()
}

function startBgProcess () {
  const p = cp.fork(__filename, ['child'], {
    stdio: 'pipe'
  })
  p.stdout.on('data', data => {
    process.stdout.write(data)
    p.unref()
    process.exit()
  })
  p.stderr.on('data', err => {
    process.stderr.write(err)
    process.exit(1)
  })
}

function startServer () {
  const npid = require('npid')
  const pid = npid.create(`${__dirname}/etherrpc.js.pid`)
  pid.removeOnExit()
  const TestRPC = require('ganache')
  const users = require('./fixtures/users')
  const { blocktime } = require('./constants')
  const { network, constants, port, networkName } = require('./ethereum-helpers')
  const server = TestRPC.server({
    chain: {
      chainId: constants.chainId
    },
    fork: {
      network: networkName
    },
    blocktime: blocktime / 1000,
    accounts: users.map(user => {
      const key = user.keys.find(key => key.networkName === network.name && key.purpose === 'messaging')
      return {
        secretKey: Buffer.from(key.priv, 'hex'),
        balance: '0x0000000000000056bc75e2d63100000'
      }
    })
  })

  server.listen(port, function (err) {
    console.log(`Listening ganache server for chainId=${constants.chainId} at http://localhost:${port} with pid ${process.pid}`)
    if (err) throw err
  })
}
