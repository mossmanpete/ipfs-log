'use strict'

const assert = require('assert')
const rmrf = require('rimraf')
const Log = require('../src/log')
const AccessController = Log.AccessController
const IdentityProvider = require('orbit-db-identity-provider')

// Test utils
const {
  config,
  testAPIs,
  startIpfs,
  stopIpfs
} = require('./utils')

let ipfs, testIdentity, testIdentity2

Object.keys(testAPIs).forEach((IPFS) => {
  describe('Signed Log (' + IPFS + ')', function () {
    this.timeout(config.timeout)

    const testACL = new AccessController()
    const { identityKeysPath, signingKeysPath } = config
    const ipfsConfig = Object.assign({}, config.defaultIpfsConfig, {
      repo: config.defaultIpfsConfig.repo + '-log-signed' + new Date().getTime()
    })

    before(async () => {
      rmrf.sync(ipfsConfig.repo)
      testIdentity = await IdentityProvider.createIdentity({ id: 'userA', identityKeysPath, signingKeysPath })
      testIdentity2 = await IdentityProvider.createIdentity({ id: 'userB', identityKeysPath, signingKeysPath })
      ipfs = await startIpfs(IPFS, ipfsConfig)
    })

    after(async () => {
      await stopIpfs(ipfs)
      rmrf.sync(ipfsConfig.repo)
    })

    it('creates a signed log', () => {
      const logId = 'A'
      const log = new Log(ipfs, testACL, testIdentity, logId)
      assert.notStrictEqual(log.id, null)
      assert.strictEqual(log.id, logId)
    })

    it('has the correct identity', () => {
      const log = new Log(ipfs, testACL, testIdentity, 'A')
      assert.notStrictEqual(log.id, null)
      assert.strictEqual(log._identity.id, '04e9224ee3451772f3ad43068313dc5bdc6d3f2c9a8c3a6ba6f73a472d5f47a96ae6d776de13f2fc2076140fd68ca900df2ca4862b06192adbf8f8cb18a99d69aa')
      assert.strictEqual(log._identity.publicKey, '0411a0d38181c9374eca3e480ecada96b1a4db9375c5e08c3991557759d22f6f2f902d0dc5364a948035002504d825308b0c257b7cbb35229c2076532531f8f4ef')
      assert.strictEqual(log._identity.signatures.id, '3045022042fa401d9ffb0c32de2f02561dc1c5e605ccc5eb33eb56fb638bb8f17bd2adb7022100d8ae57f2d401c1fe0fb1614897f1c731a201230bc269e1a04d1f7d9faecc3ef7')
      assert.strictEqual(log._identity.signatures.publicKey, '304402206b9c218629d3cd692ad074586834aefe9da480429352870562bb0b601129363e02203717125e9cdb85bea1f84f74d48e6a04b73cda28660486530f4a4fccacdbfa84')
    })

    it('has the correct public key', () => {
      const log = new Log(ipfs, testACL, testIdentity, 'A')
      assert.strictEqual(log._identity.publicKey, testIdentity.publicKey)
    })

    it('has the correct pkSignature', () => {
      const log = new Log(ipfs, testACL, testIdentity, 'A')
      assert.strictEqual(log._identity.signatures.id, testIdentity.signatures.id)
    })

    it('has the correct signature', () => {
      const log = new Log(ipfs, testACL, testIdentity, 'A')
      assert.strictEqual(log._identity.signatures.publicKey, testIdentity.signatures.publicKey)
    })

    it('entries contain an identity', async () => {
      const log = new Log(ipfs, testACL, testIdentity, 'A')
      await log.append('one')
      assert.notStrictEqual(log.values[0].sig, null)
      assert.deepStrictEqual(log.values[0].identity, testIdentity.toJSON())
    })

    it('doesn\'t sign entries when access controller is not defined', async () => {
      let err
      try {
        const log = new Log(ipfs) // eslint-disable-line no-unused-vars
      } catch (e) {
        err = e.toString()
      }
      assert.strictEqual(err, 'Error: Access controller is required')
    })

    it('doesn\'t join logs with different IDs ', async () => {
      const log1 = new Log(ipfs, testACL, testIdentity, 'A')
      const log2 = new Log(ipfs, testACL, testIdentity2, 'B')

      let err
      try {
        await log1.append('one')
        await log2.append('two')
        await log2.append('three')
        await log1.join(log2)
      } catch (e) {
        err = e.toString()
        throw e
      }

      assert.strictEqual(err, undefined)
      assert.strictEqual(log1.id, 'A')
      assert.strictEqual(log1.values.length, 1)
      assert.strictEqual(log1.values[0].payload, 'one')
    })

    it('throws an error if log is signed but trying to merge with an entry that doesn\'t have public signing key', async () => {
      const log1 = new Log(ipfs, testACL, testIdentity, 'A')
      const log2 = new Log(ipfs, testACL, testIdentity2, 'A')

      let err
      try {
        await log1.append('one')
        await log2.append('two')
        delete log2.values[0].key
        await log1.join(log2)
      } catch (e) {
        err = e.toString()
      }
      assert.strictEqual(err, 'Error: Entry doesn\'t have a key')
    })

    it('throws an error if log is signed but trying to merge an entry that doesn\'t have a signature', async () => {
      const log1 = new Log(ipfs, testACL, testIdentity, 'A')
      const log2 = new Log(ipfs, testACL, testIdentity2, 'A')

      let err
      try {
        await log1.append('one')
        await log2.append('two')
        delete log2.values[0].sig
        await log1.join(log2)
      } catch (e) {
        err = e.toString()
      }
      assert.strictEqual(err, 'Error: Entry doesn\'t have a signature')
    })

    it('throws an error if log is signed but the signature doesn\'t verify', async () => {
      const replaceAt = (str, index, replacement) => {
        return str.substr(0, index) + replacement + str.substr(index + replacement.length)
      }

      const log1 = new Log(ipfs, testACL, testIdentity, 'A')
      const log2 = new Log(ipfs, testACL, testIdentity2, 'A')
      let err

      try {
        await log1.append('one')
        await log2.append('two')
        log2.values[0].sig = replaceAt(log2.values[0].sig, 0, 'X')
        await log1.join(log2)
      } catch (e) {
        err = e.toString()
      }

      const entry = log2.values[0]
      assert.strictEqual(err, `Error: Could not validate signature "${entry.sig}" for entry "${entry.hash}" and key "${entry.key}"`)
      assert.strictEqual(log1.values.length, 1)
      assert.strictEqual(log1.values[0].payload, 'one')
    })

    it('throws an error if entry doesn\'t have append access', async () => {
      const testACL2 = { canAppend: () => false }
      const log1 = new Log(ipfs, testACL, testIdentity, 'A')
      const log2 = new Log(ipfs, testACL2, testIdentity2, 'A')

      let err
      try {
        await log1.append('one')
        await log2.append('two')
        await log1.join(log2)
      } catch (e) {
        err = e.toString()
      }

      assert.strictEqual(err, `Error: Could not append entry, key "${testIdentity2.id}" is not allowed to write to the log`)
    })

    it('throws an error upon join if entry doesn\'t have append access', async () => {
      let testACL2 = { canAppend: () => true }
      const log1 = new Log(ipfs, testACL2, testIdentity, 'A')
      const log2 = new Log(ipfs, testACL2, testIdentity2, 'A')

      let err
      try {
        await log1.append('one')
        await log2.append('two')
        testACL2 = {
          canAppend: (entry) => entry.identity.id !== testIdentity2.id
        }
        log1._access = testACL2 // monkey patch the log's acl
        // Identity2 (log2) should not have append access anymore
        await log1.join(log2)
      } catch (e) {
        err = e.toString()
      }

      assert.strictEqual(err, `Error: Could not append entry, key "${testIdentity2.id}" is not allowed to write to the log`)
    })
  })
})
