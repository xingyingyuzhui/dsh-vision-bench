// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { UvSockClient } from '../../src/infrastructure/debug/keil/uvsock-client.mjs'

test('F06: UvSockClient connect to closed port rejects cleanly without crashing with unhandled error', async () => {
  // Use a port that is guaranteed not to be open (e.g. port 1 or unused high loopback port)
  const client = new UvSockClient({
    host: '127.0.0.1',
    port: 59999,
    timeoutMs: 1000,
  })

  // Do not register 'error' listener intentionally to verify that no unhandled 'error' event is thrown
  await assert.rejects(
    async () => {
      await client.connect()
    },
    (err) => {
      assert.ok(err instanceof Error)
      return true
    },
  )

  client.close()
})
