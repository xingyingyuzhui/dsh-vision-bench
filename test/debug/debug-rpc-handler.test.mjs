import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'

test('Debug RPC Handler routes state, commands, and events over Connection RPC', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      start: async () => {},
      stop: async () => {},
      continue: async () => {},
      pause: async () => {},
      step: async () => {},
    }),
  })

  const handler = createDebugRpcHandler({ debugRuntime: runtime })

  // 1. Initial state (no active session)
  const initState = await handler('debug/state', { cwd: '/workspace', sessionId: 'sess_1' })
  assert.equal(initState.ok, true)
  assert.equal(initState.active, false)

  // 2. Start session via debug/command op: 'start'
  const startRes = await handler('debug/command', {
    cwd: '/workspace',
    sessionId: 'sess_1',
    op: 'start',
    targetSpec: { target: 'stm32f4x' },
  })
  assert.equal(startRes.ok, true)
  assert.ok(startRes.debugSessionId)
  assert.equal(startRes.session.state, 'ready')

  const debugSessionId = startRes.debugSessionId

  // 3. State query now reports active session
  const activeState = await handler('debug/state', { cwd: '/workspace', sessionId: 'sess_1' })
  assert.equal(activeState.ok, true)
  assert.equal(activeState.active, true)
  assert.equal(activeState.session.debugSessionId, debugSessionId)

  // 4. Execution commands
  const contRes = await handler('debug/command', {
    debugSessionId,
    sessionId: 'sess_1',
    op: 'continue',
  })
  assert.equal(contRes.ok, true)
  assert.equal(contRes.state, 'running')

  const pauseRes = await handler('debug/command', {
    debugSessionId,
    sessionId: 'sess_1',
    op: 'pause',
  })
  assert.equal(pauseRes.ok, true)
  assert.equal(pauseRes.state, 'paused')

  const stepRes = await handler('debug/command', {
    debugSessionId,
    sessionId: 'sess_1',
    op: 'step',
    stepType: 'over',
  })
  assert.equal(stepRes.ok, true)

  // 5. Breakpoints
  const bpRes = await handler('debug/command', {
    debugSessionId,
    sessionId: 'sess_1',
    op: 'addBreakpoint',
    file: 'main.c',
    line: 42,
  })
  assert.equal(bpRes.ok, true)
  assert.equal(bpRes.breakpoint.line, 42)

  // 6. Long-polling events wait
  const eventsWait = await handler('debug/events/wait', {
    debugSessionId,
    sessionId: 'sess_1',
    cursor: 0,
    timeoutMs: 100,
  })
  assert.equal(eventsWait.ok, true)
  assert.ok(Array.isArray(eventsWait.events))
  assert.ok(eventsWait.events.length > 0)
  assert.equal(eventsWait.closed, false)

  // 7. Security: Another session cannot control or stop this session
  const hijack = await handler('debug/command', {
    debugSessionId,
    sessionId: 'sess_attacker',
    op: 'pause',
  })
  assert.equal(hijack.ok, false)
  assert.equal(hijack.errorCode, 'DEBUG_SESSION_NOT_OWNER')

  // 8. Stop session
  const stopRes = await handler('debug/command', {
    debugSessionId,
    sessionId: 'sess_1',
    op: 'stop',
  })
  assert.equal(stopRes.ok, true)

  // 9. State query after stop
  const postState = await handler('debug/state', { cwd: '/workspace', sessionId: 'sess_1' })
  assert.equal(postState.ok, true)
  assert.equal(postState.active, false)
})

test('debug events/wait without session identity does not return another session', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      start: async () => {},
      stop: async () => {},
    }),
  })
  const handler = createDebugRpcHandler({ debugRuntime: runtime })
  const started = await handler('debug/command', {
    cwd: '/workspace/other',
    sessionId: 'owner-other',
    op: 'start',
    targetSpec: { target: 'stm32f4x' },
  })
  assert.equal(started.ok, true)
  const t0 = Date.now()
  for (let i = 0; i < 100; i++) {
    const waitRes = await handler('debug/events/wait', { cwd: '/workspace/other', sessionId: '', timeoutMs: 20000 })
    assert.equal(waitRes.ok, true)
    assert.equal(waitRes.woke, false)
    assert.equal(waitRes.debugSessionId, undefined)
    assert.equal(waitRes.identityRequired, true)
  }
  assert.ok(Date.now() - t0 < 1000)
  await handler('debug/command', {
    debugSessionId: started.debugSessionId,
    sessionId: 'owner-other',
    op: 'stop',
  })
})
