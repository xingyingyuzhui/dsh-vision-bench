import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { createVisionRpcRouter } from '../../src/interfaces/rpc/vision-rpc-router.mjs'

test('createVisionRpcRouter routes debug/* endpoints without Modbus interference', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      start: async () => {},
      stop: async () => {},
      continue: async () => {},
      pause: async () => {},
    }),
  })

  const router = createVisionRpcRouter({
    getHome: () => '/tmp',
    debugRuntime: runtime,
  })

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
