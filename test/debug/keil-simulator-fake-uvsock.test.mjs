// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugEventRing } from '../../src/domain/debug/debug-event.mjs'
import { KeilSimBackend } from '../../src/infrastructure/debug/keil/keil-sim-backend.mjs'
import { UvSockClient } from '../../src/infrastructure/debug/keil/uvsock-client.mjs'
import { FakeUvSockServer } from '../helpers/fake-uvsock-server.mjs'

test('KeilSimBackend: full lifecycle integration with FakeUvSockServer', async () => {
  const server = new FakeUvSockServer()
  const { port, host } = await server.start()

  const client = new UvSockClient({ host, port, timeoutMs: 2000 })
  const eventRing = createDebugEventRing(100)

  const backend = new KeilSimBackend({
    debugSessionId: 'dbg_keil_fake_1',
    ownerSessionId: 'owner_session_1',
    workspaceCwd: '/workspaces/keil_proj',
    eventRing,
    uvsockClient: client,
  })

  /** @type {import('../../src/types/debug-backend.d.ts').DebugBackendEvent[]} */
  const events = []
  backend.subscribe((ev) => events.push(ev))

  try {
    // 1. Start
    const startRes = await backend.start({
      targetSpec: {
        projectPath: '/workspaces/keil_proj/demo.uvprojx',
        target: 'Target 1',
        host,
        port,
      },
    })
    assert.equal(startRes.ok, true)
    assert.equal(backend.state, 'paused')

    // 2. Continue
    await backend.continue()
    assert.equal(backend.state, 'running')
    assert.ok(events.some((e) => e.type === 'backend.running'))

    // 3. Fake server emits unsolicited stop (breakpoint hit)
    server.sendAsyncStop('breakpoint-hit at main.c:20')
    await new Promise((r) => setTimeout(r, 100))

    assert.equal(backend.state, 'paused')
    assert.ok(events.some((e) => e.type === 'backend.stopped' && e.reason === 'breakpoint'))

    // 4. Step
    await backend.step('over')
    assert.equal(backend.state, 'paused')

    // 5. Evaluate
    const evalVal = await backend.evaluate('sensor_var')
    assert.equal(evalVal, '42')

    // 6. Memory read
    const memHex = await backend.readMemory('0x20000000', 8)
    assert.equal(memHex, '0102030405060708')

    // 7. Breakpoint
    const bp = await backend.addBreakpoint({
      id: 'bp_uvsock_1',
      file: 'main.c',
      line: 50,
      verified: false,
    })
    assert.equal(bp.verified, true)

    await backend.removeBreakpoint('bp_uvsock_1')

    // 8. Stop
    const stopRes = await backend.stop()
    assert.equal(stopRes.ok, true)
    assert.equal(backend.state, 'idle')
    assert.ok(events.some((e) => e.type === 'backend.exited'))
  } finally {
    client.close()
    await server.stop()
  }
})
