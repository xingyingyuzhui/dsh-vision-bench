// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { UvSockClient } from '../../src/infrastructure/debug/keil/uvsock-client.mjs'
import { FakeUvSockServer } from '../helpers/fake-uvsock-server.mjs'

test('uvsock-fake-server: UvSockClient communicates end-to-end with FakeUvSockServer', async () => {
  const server = new FakeUvSockServer()
  const { port, host } = await server.start()

  const client = new UvSockClient({ host, port, timeoutMs: 2000 })
  await client.connect()
  assert.equal(client.connected, true)

  // 1. Get version
  const ver = await client.getVersion()
  assert.equal(ver.version, '2.12')
  assert.equal(ver.raw, 0x020c)

  // 2. Load project
  const loadRes = await client.loadProject('C:\\Projects\\Firmware.uvprojx')
  assert.equal(loadRes.ok, true)

  // 3. Current target
  const target = await client.getCurrentTarget()
  assert.equal(target, 'Target 1')

  // 4. Debug status
  const status = await client.getDebugStatus()
  assert.equal(status.stopped, true)
  assert.equal(status.executing, false)

  // 5. Evaluate expression
  const exprRes = await client.evaluateExpression('40 + 2')
  assert.equal(exprRes.value, '42')

  // 6. Breakpoint creation
  const bpRes = await client.createBreakpoint({ file: 'main.c', line: 42 })
  assert.equal(bpRes.verified, true)
  assert.equal(bpRes.id, '101')

  // 7. Memory read
  const memRes = await client.readMemory('0x20000000', 8)
  assert.equal(memRes.hex, '0102030405060708')
  assert.deepEqual(memRes.bytes, [1, 2, 3, 4, 5, 6, 7, 8])

  // 8. Async notification
  /** @type {any[]} */
  const asyncEvents = []
  client.onAsync((ev) => asyncEvents.push(ev))

  server.sendAsyncStop('breakpoint at main.c:42')
  await new Promise((r) => setTimeout(r, 100))

  assert.equal(asyncEvents.length, 1)
  assert.ok(asyncEvents[0].details?.error?.message.includes('breakpoint at main.c:42'))

  client.close()
  await server.stop()
})
