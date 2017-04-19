
# Blockchain Adapters

A blockchain adapter consists of several APIs that `@tradle/engine` calls for reading and writing blockchain seals: `network`, `transactor`, and `blockchain`.

Existing adapters:

- [bitcoin](https://github.com/tradle/bitcoin-adapter)
- [ethereum](https://github.com/tradle/ethereum-adapter)

## Network

Pass in a `network` object when initializing a tradle node:

```js
new tradle.node({
//  ...
  network: {
    blockchain: 'bitcoin',
    name: 'testnet',
    minOutputAmount: 547,
    pubKeyToAddress: Buffer => String
  }
// ...
})
```

## Blockchain

```js
new tradle.node({
//  ...
  blockchain: {
    transactions: {
      // fetch transactions by id
      get: function (txIds, cb) {
        // ...
        // see below for Transaction Object format
        cb(null, [txObjects])
      }
    },
    addresses: {
      // fetch transactions by to/from addresses
      transactions: function (addresses, [height], cb) {
        // ...
        // see below for Transaction Object format
        cb(null, [txObjects])
      }
    }
  }
// ...
})
```

## Transaction Object

```js
{
  blockHeight: Number,
  txId: String, // hex
  confirmations: Number,
  from: {
    addresses: [String, String, ...]
  },
  to: {
    addresses: [String, String, ...]
  }
}
```

## Transactor

The transactor API is for writing blockchain seals. If you're running a read-only node, you can omit it.

```js
new tradle.node({
//  ...
  transactor: {
    send: function (opts, cb) {
      console.log(opts)
      // array of output address and amount pairs
      // [{ address, amount }, ...]
      // ...
      // call back with the txId of the created transaction
      cb(null, { txId })
    }
  }
// ...
})
```
