// @ts-check
import assert from 'node:assert/strict'
import { createServer } from 'node:net'
import test from 'node:test'
import { allocateLoopbackPort, isPortAvailable } from '../../src/infrastructure/network/loopback-port.mjs'

test('loopback port: allocates an open port and confirms availability', async () => {
  const port = await allocateLoopbackPort()
  assert.ok(port > 1024)
  assert.ok(port <= 65535)

  const isFree = await isPortAvailable(port)
  assert.equal(isFree, true)
})

test('loopback port: detects occupied port and falls back to dynamic port', async () => {
  // Occupy a port
  const server = createServer()
  await new Promise((resolve) => server.listen(0, '127.0.0.1', resolve))
  const occupiedPort = /** @type {import('node:net').AddressInfo} */ (server.address()).port

  try {
    const isFree = await isPortAvailable(occupiedPort)
    assert.equal(isFree, false)

    // Requesting the occupied port as preferred must allocate another port
    const allocated = await allocateLoopbackPort(occupiedPort)
    assert.ok(allocated > 0)
    assert.notEqual(allocated, occupiedPort)
  } finally {
    await new Promise((resolve) => server.close(resolve))
  }
})
