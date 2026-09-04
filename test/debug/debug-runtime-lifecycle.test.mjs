import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'

class FakeDebugBackend {
  constructor(ctx) {
    this.ctx = ctx
    this.started = false
    this.stopped = false
    this.breakpoints = []
  }

  async start() {
    this.started = true
  }

  async stop() {
    this.stopped = true
  }

  async continue() {}

  async pause() {}

  async step() {}

  async addBreakpoint(bp) {
    this.breakpoints.push(bp)
  }

  async removeBreakpoint(bp) {
    this.breakpoints = this.breakpoints.filter((b) => b.id !== bp.id)
  }
}

test('DebugRuntime completes full session lifecycle with fake backend', async () => {
  let backendInstance = null
  const runtime = createDebugRuntime({
    backendFactory: async (_kind, ctx) => {
      backendInstance = new FakeDebugBackend(ctx)
      return backendInstance
    },
  })

  // 1. Start session
  const view = await runtime.start({
    debugSessionId: 'sess-debug-1',
    ownerSessionId: 'client-sess-1',
    workspaceCwd: '/workspace/project',
    backend: 'fake',
    targetSpec: { interfaceName: 'cmsis-dap', target: 'stm32f1x' },
  })

  assert.equal(view.debugSessionId, 'sess-debug-1')
  assert.equal(view.state, 'ready')
  assert.equal(backendInstance.started, true)

  // 2. Commands: add breakpoint, continue, pause, step, snapshot
  const bpRes = await runtime.command(
    { debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' },
    { type: 'addBreakpoint', file: 'main.c', line: 42 },
  )
  assert.equal(bpRes.ok, true)
  assert.equal(bpRes.breakpoint.line, 42)

  const contRes = await runtime.command(
    { debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' },
    { type: 'continue' },
  )
  assert.equal(contRes.state, 'running')

  const pauseRes = await runtime.command(
    { debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' },
    { type: 'pause' },
  )
  assert.equal(pauseRes.state, 'paused')

  const snapRes = await runtime.command(
    { debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' },
    { type: 'snapshot', reason: 'agent_diagnostic' },
  )
  assert.equal(snapRes.ok, true)
  assert.equal(snapRes.snapshot.reason, 'agent_diagnostic')

  // 3. Inspect state
  const stateView = runtime.state({ debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' })
  assert.equal(stateView.state, 'paused')
  assert.equal(stateView.breakpoints.length, 1)

  // 4. Stop session
  const stopRes = await runtime.stop({ debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' })
  assert.equal(stopRes.ok, true)
  assert.equal(backendInstance.stopped, true)

  // After stop, session is gone
  assert.throws(
    () => runtime.state({ debugSessionId: 'sess-debug-1', ownerSessionId: 'client-sess-1' }),
    (err) => err instanceof DebugError && err.code === DEBUG_ERRORS.NOT_FOUND,
  )
})

test('DebugRuntime isolates foreign sessions and rejects unauthorized control', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async (_kind, ctx) => new FakeDebugBackend(ctx),
  })

  await runtime.start({
    debugSessionId: 'sess-a',
    ownerSessionId: 'owner-alice',
    workspaceCwd: '/workspace/project',
    backend: 'fake',
    targetSpec: { interfaceName: 'cmsis-dap', target: 'stm32f4x' },
  })

  // Session Bob cannot control Session Alice's debug session
  await assert.rejects(
    () => runtime.command({ debugSessionId: 'sess-a', ownerSessionId: 'owner-bob' }, { type: 'continue' }),
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.NOT_OWNER)
      return true
    },
  )

  // Session Bob cannot stop Session Alice's debug session
  await assert.rejects(
    () => runtime.stop({ debugSessionId: 'sess-a', ownerSessionId: 'owner-bob' }),
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.NOT_OWNER)
      return true
    },
  )

  // Session Bob trying to start debugging the same target gets DEBUG_TARGET_BUSY
  await assert.rejects(
    () =>
      runtime.start({
        debugSessionId: 'sess-b',
        ownerSessionId: 'owner-bob',
        workspaceCwd: '/workspace/project',
        backend: 'fake',
        targetSpec: { interfaceName: 'cmsis-dap', target: 'stm32f4x' },
      }),
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.TARGET_BUSY)
      return true
    },
  )

  // Alice stops -> lease freed
  await runtime.stop({ debugSessionId: 'sess-a', ownerSessionId: 'owner-alice' })

  // Now Bob can start
  const bobView = await runtime.start({
    debugSessionId: 'sess-b',
    ownerSessionId: 'owner-bob',
    workspaceCwd: '/workspace/project',
    backend: 'fake',
    targetSpec: { interfaceName: 'cmsis-dap', target: 'stm32f4x' },
  })
  assert.equal(bobView.state, 'ready')
  await runtime.stop({ debugSessionId: 'sess-b', ownerSessionId: 'owner-bob' })
})

test('DebugRuntime cleans up lease on failed backend start', async () => {
  const runtime = createDebugRuntime({
    backendFactory: async () => {
      throw new Error('GDB connection refused')
    },
  })

  await assert.rejects(
    () =>
      runtime.start({
        debugSessionId: 'sess-fail',
        ownerSessionId: 'owner-fail',
        workspaceCwd: '/workspace/project',
        backend: 'fake',
        targetSpec: { interfaceName: 'cmsis-dap', target: 'stm32f1x' },
      }),
    /GDB connection refused/,
  )

  // Target lease was released and can be acquired again
  assert.equal(runtime.getLeaseManager().getLease('fake:cmsis-dap:stm32f1x:/workspace/project'), null)
})
