import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'
import { createRouter } from '../helpers/rpc-factory.mjs'
import { DEBUG_RPC_ENDPOINTS } from '../../src/shared/debug-contract.mjs'

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

test('createRouter routes debug/* endpoints without Modbus interference', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      start: async () => {},
      stop: async () => {},
      continue: async () => {},
      pause: async () => {},
    }),
  })

  const router = createRouter('/tmp', { debugRuntime: runtime })

  // Start debug session through router
  const start = await router.dispatch('debug/command', {
    cwd: '/workspace',
    sessionId: 'test_session_1',
    op: 'start',
    targetSpec: { target: 'stm32f4x' },
  })

  assert.equal(start.ok, true)
  assert.ok(start.debugSessionId)

  // Query state through router
  const state = await router.dispatch('debug/state', {
    cwd: '/workspace',
    sessionId: 'test_session_1',
  })

  assert.equal(state.ok, true)
  assert.equal(state.active, true)
  assert.equal(state.session.state, 'ready')

  // Wait events through router
  const events = await router.dispatch('debug/events/wait', {
    debugSessionId: start.debugSessionId,
    sessionId: 'test_session_1',
    cursor: 0,
    timeoutMs: 100,
  })

  assert.equal(events.ok, true)
  assert.ok(events.events.length > 0)

  // Stop debug session through router
  const stop = await router.dispatch('debug/command', {
    debugSessionId: start.debugSessionId,
    sessionId: 'test_session_1',
    op: 'stop',
  })

  assert.equal(stop.ok, true)
})

test('PR-2: Browser RPC session isolation: same cwd foreign session cannot claim or observe debug session', async () => {
  const runtime = createDebugRuntime({
    backendFactory: () => ({
      start: async () => {},
      stop: async () => {},
    }),
  })

  const handler = createDebugRpcHandler({ debugRuntime: runtime })

  // Session A in /workspace/app1 starts debug session
  const startRes = await runtime.start({
    ownerSessionId: 'session_A',
    workspaceCwd: '/workspace/app1',
    backend: 'gdb-openocd',
    targetSpec: {
      artifactPath: '/workspace/app1/build.elf',
      interfaceName: 'cmsis-dap',
      probeSerial: 'PROBE_123',
    },
  })
  assert.ok(startRes.debugSessionId)

  // Session A queries state: active = true
  const stateA = await handler(DEBUG_RPC_ENDPOINTS.STATE, {
    sessionId: 'session_A',
    cwd: '/workspace/app1',
  })
  assert.equal(stateA.ok, true)
  assert.equal(stateA.active, true)
  assert.equal(stateA.session?.debugSessionId, startRes.debugSessionId)

  // Session B in SAME cwd (/workspace/app1) queries state: must be active = false, session = null
  const stateB = await handler(DEBUG_RPC_ENDPOINTS.STATE, {
    sessionId: 'session_B',
    cwd: '/workspace/app1',
  })
  assert.equal(stateB.ok, true)
  assert.equal(stateB.active, false)
  assert.equal(stateB.session, null)

  // Session B cannot stop Session A
  const stopB = await handler(DEBUG_RPC_ENDPOINTS.COMMAND, {
    sessionId: 'session_B',
    cwd: '/workspace/app1',
    op: 'stop',
  })
  assert.equal(stopB.alreadyStopped, true)

  // Session A is still running
  const stateA2 = await handler(DEBUG_RPC_ENDPOINTS.STATE, {
    sessionId: 'session_A',
    cwd: '/workspace/app1',
  })
  assert.equal(stateA2.active, true)

  await runtime.shutdown()
})
