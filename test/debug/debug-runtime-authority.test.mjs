// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { DEBUG_EVENT_TYPES } from '../../src/shared/debug-events.mjs'

/**
 * Creates an event-driven mock backend implementing DebugBackend event contract.
 */
function createMockEventBackend() {
  /** @type {Set<(ev: any) => void>} */
  const listeners = new Set()

  return {
    listeners,
    subscribe(listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    emit(event) {
      for (const l of listeners) l(event)
    },
    async start() {},
    async stop() {},
    async continue() {},
    async requestPause() {},
    async pause() {},
    async stepOver() {},
    async stepInto() {},
    async stepOut() {},
    async step() {},
    async resetHalt() {},
    async stack() {
      return [{ level: 0, function: 'worker_task', file: 'worker.c', line: 55, address: '0x08000420' }]
    },
    async locals() {
      return [{ name: 'counter', value: '42', type: 'uint32_t' }]
    },
  }
}

test('DebugRuntime authority: translates backend.running, backend.stopped, backend.console, and backend.exited', async () => {
  const backend = createMockEventBackend()
  const runtime = createDebugRuntime({
    backendFactory: async () => backend,
  })

  const session = await runtime.start({
    debugSessionId: 'sess_auth_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/work',
    backend: 'gdb-openocd',
    targetSpec: { target: 'stm32f4x' },
  })

  assert.equal(session.state, 'ready')

  // 1. Backend emits running
  backend.emit({
    type: 'backend.running',
    threadId: '1',
  })

  let state = runtime.state({ debugSessionId: 'sess_auth_1', ownerSessionId: 'owner_1' })
  assert.equal(state.state, 'running')

  // 2. Backend emits stopped on breakpoint
  backend.emit({
    type: 'backend.stopped',
    reason: 'breakpoint',
    breakpointNumber: '2',
    location: { file: 'worker.c', line: 55, function: 'worker_task', address: '0x08000420' },
  })

  state = runtime.state({ debugSessionId: 'sess_auth_1', ownerSessionId: 'owner_1' })
  assert.equal(state.state, 'paused')
  assert.equal(state.location?.function, 'worker_task')

  // 3. Backend emits console output
  backend.emit({
    type: 'backend.console',
    stream: 'console',
    text: 'Breakpoint 2 hit at worker.c:55\n',
  })

  // 4. Backend emits watchpoint stop
  backend.emit({
    type: 'backend.stopped',
    reason: 'watchpoint',
    watchpointNumber: '1',
    location: { file: 'worker.c', line: 56, function: 'worker_task', address: '0x08000424' },
  })

  // 5. Backend exits unexpectedly
  backend.emit({
    type: 'backend.exited',
    code: 1,
    signal: 'SIGSEGV',
    unexpected: true,
  })

  state = runtime.state({ debugSessionId: 'sess_auth_1', ownerSessionId: 'owner_1' })
  assert.equal(state.state, 'failed')

  // Check event ring history
  const evRes = await runtime.waitEvents({ debugSessionId: 'sess_auth_1', ownerSessionId: 'owner_1' }, 0)
  const types = evRes.events.map((e) => e.type)

  assert.ok(types.includes(DEBUG_EVENT_TYPES.RUNNING))
  assert.ok(types.includes(DEBUG_EVENT_TYPES.BREAKPOINT_HIT))
  assert.ok(types.includes(DEBUG_EVENT_TYPES.CONSOLE))
  assert.ok(types.includes(DEBUG_EVENT_TYPES.WATCHPOINT_HIT))
  assert.ok(types.includes(DEBUG_EVENT_TYPES.SESSION_FAILED))
  assert.ok(types.includes(DEBUG_EVENT_TYPES.SESSION_STOPPED))

  await runtime.shutdown()
})

test('DebugRuntime authority: enforces asynchronous step and pause without synchronous fake completion', async () => {
  const backend = createMockEventBackend()
  let stepOverCalled = false
  let pauseCalled = false

  backend.stepOver = async () => {
    stepOverCalled = true
  }
  backend.requestPause = async () => {
    pauseCalled = true
  }

  const runtime = createDebugRuntime({
    backendFactory: async () => backend,
  })

  await runtime.start({
    debugSessionId: 'sess_async_1',
    ownerSessionId: 'owner_1',
    workspaceCwd: '/work',
    backend: 'gdb-openocd',
    targetSpec: { target: 'stm32f4x' },
  })

  // 1. Dispatch step
  const stepRes = await runtime.command(
    { debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' },
    { type: 'step', stepType: 'over' },
  )

  assert.equal(stepOverCalled, true)
  assert.equal(stepRes.ok, true)
  assert.equal(stepRes.pending, true)

  // Verify that STEP_COMPLETE is NOT yet in the event ring
  let events = (await runtime.waitEvents({ debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' }, 0)).events
  assert.ok(!events.some((e) => e.type === DEBUG_EVENT_TYPES.STEP_COMPLETE))

  // Now backend reports stopped at next line
  backend.emit({
    type: 'backend.stopped',
    reason: 'step',
    location: { file: 'worker.c', line: 56, function: 'worker_task', address: '0x08000424' },
  })

  // Now STEP_COMPLETE is emitted!
  events = (await runtime.waitEvents({ debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' }, 0)).events
  const stepEvent = events.find((e) => e.type === DEBUG_EVENT_TYPES.STEP_COMPLETE)
  assert.ok(stepEvent)
  assert.equal(stepEvent.payload.stepType, 'over')
  assert.equal(stepEvent.payload.location.line, 56)

  // 2. Continue then dispatch pause
  await runtime.command({ debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' }, { type: 'continue' })
  backend.emit({ type: 'backend.running' })

  const pauseRes = await runtime.command(
    { debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' },
    { type: 'pause' },
  )

  assert.equal(pauseCalled, true)
  assert.equal(pauseRes.ok, true)
  assert.equal(pauseRes.pending, true)

  // Verify PAUSED is not yet emitted for this pause
  const prePauseEvents = (await runtime.waitEvents({ debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' }, 0))
    .events
  const lastEventBeforeStop = prePauseEvents[prePauseEvents.length - 1]
  assert.equal(lastEventBeforeStop.type, DEBUG_EVENT_TYPES.RUNNING)

  // Now backend reports stopped with manual/pause reason
  backend.emit({
    type: 'backend.stopped',
    reason: 'manual',
    location: { file: 'worker.c', line: 70, function: 'worker_task', address: '0x08000460' },
  })

  const postPauseEvents = (await runtime.waitEvents({ debugSessionId: 'sess_async_1', ownerSessionId: 'owner_1' }, 0))
    .events
  const pausedEvent = postPauseEvents.find((e) => e.type === DEBUG_EVENT_TYPES.PAUSED && e.payload?.reason === 'manual')
  assert.ok(pausedEvent)
  assert.equal(pausedEvent.payload.location.line, 70)

  await runtime.shutdown()
})
