// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'

test('F05: debug runtime start gracefully handles stopped event emitted during startup without throwing invalid transition', async () => {
  let backendStopped = false
  const runtime = createDebugRuntime({
    backendFactory: async (_kind, { eventRing }) => {
      /** @type {any} */
      let subCb = null
      return {
        kind: 'fake',
        subscribe: (cb) => {
          subCb = cb
          return () => {}
        },
        start: async () => {
          // Backend immediately reports stopped on initial attach
          if (subCb) {
            subCb({
              type: 'backend.stopped',
              reason: 'breakpoint',
              location: { file: 'main.c', line: 42 },
            })
          }
        },
        stop: async () => {
          backendStopped = true
        },
        command: async () => ({ ok: true }),
      }
    },
  })

  const session = await runtime.start({
    ownerSessionId: 'test_owner',
    workspaceCwd: '/tmp/test_cwd',
    backend: 'fake',
    targetSpec: {},
  })

  // State should be 'paused' (from backend.stopped) and NOT throw paused -> ready
  assert.equal(session.state, 'paused')
  assert.equal(session.location?.line, 42)

  await runtime.shutdown()
})

test('F05: debug runtime cleans up backend, unsubs, and releases lease when backend.start throws', async () => {
  let backendStopCalled = false
  let backendUnsubCalled = false

  const runtime = createDebugRuntime({
    backendFactory: async () => {
      return {
        kind: 'fake',
        subscribe: () => () => {
          backendUnsubCalled = true
        },
        start: async () => {
          throw new Error('Hardware connection timeout during start')
        },
        stop: async () => {
          backendStopCalled = true
        },
        command: async () => ({ ok: true }),
      }
    },
  })

  await assert.rejects(async () => {
    await runtime.start({
      ownerSessionId: 'test_owner_fail',
      workspaceCwd: '/tmp/test_cwd_fail',
      backend: 'fake',
      targetSpec: {},
    })
  }, /Hardware connection timeout during start/)

  // Verify backend was stopped, unsubscribe was called, and no session remains
  assert.equal(backendStopCalled, true)
  assert.equal(backendUnsubCalled, true)
  assert.equal(runtime.findOwnedSession({ ownerSessionId: 'test_owner_fail' }), null)
})
