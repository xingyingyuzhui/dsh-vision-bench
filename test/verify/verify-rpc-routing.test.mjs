import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyTelemetryAdapter } from '../../src/infrastructure/modbus/verify-telemetry-adapter.mjs'
import { createVisionRpcRouter } from '../../src/interfaces/rpc/vision-rpc-router.mjs'

test('vision-rpc-router: dispatches verify/run, verify/status, and verify/cancel endpoints', async () => {
  const adapter = createVerifyTelemetryAdapter()
  adapter.publishPointValue('flow_rate', 15.2)

  const router = createVisionRpcRouter({
    getHome: () => '/test/home',
    telemetryReader: adapter,
  })

  // 1. Run scenario via canonical endpoint `verify/run`
  const runRes = /** @type {any} */ (
    await router.dispatch('verify/run', {
      cwd: '/test/cwd',
      sessionId: 'sess-verify-rpc',
      scenario: {
        name: 'RPC Verify Flow',
        assertions: [
          {
            type: 'modbus.point',
            pointId: 'flow_rate',
            operator: '==',
            expected: 15.2,
          },
        ],
      },
    })
  )

  assert.ok(runRes.ok)
  assert.ok(runRes.verificationRunId)
  assert.ok(runRes.verificationRunId.startsWith('vr_'))
  assert.equal(runRes.result.status, 'pass')

  // 2. Query status via canonical endpoint `verify/status`
  const statusRes = /** @type {any} */ (
    await router.dispatch('verify/status', {
      verificationRunId: runRes.verificationRunId,
    })
  )

  assert.ok(statusRes.ok)
  assert.equal(statusRes.running, false)
  assert.equal(statusRes.result.status, 'pass')

  // 3. Test backward compatibility alias `vision.verify.status`
  const compatStatusRes = /** @type {any} */ (
    await router.dispatch('vision.verify.status', {
      verificationRunId: runRes.verificationRunId,
    })
  )

  assert.ok(compatStatusRes.ok)
  assert.equal(compatStatusRes.result.verificationRunId, runRes.verificationRunId)
})
