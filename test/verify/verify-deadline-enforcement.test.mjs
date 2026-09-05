// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'

test('verify-service: slow evaluate beyond timeoutMs aborts and returns timeout status', async () => {
  // Mock debugRuntime where evaluate hangs for 1500ms
  const mockDebugRuntime = {
    findSession: () => ({ debugSessionId: 'dbg-1', ownerSessionId: 'sess-1' }),
    state: () => ({ debugSessionId: 'dbg-1', ownerSessionId: 'sess-1' }),
    command: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return { result: '123' }
    },
  }

  const verifyService = createVerifyService({
    debugRuntime: mockDebugRuntime,
  })

  const start = Date.now()
  const result = await verifyService.runVerification({
    scenario: {
      id: 'sc-eval-timeout',
      name: 'Hanging Evaluate Scenario',
      timeoutMs: 60, // 60ms hard timeout
      assertions: [
        {
          type: 'debug.expression',
          expr: 'g_counter',
          operator: '==',
          expected: 123,
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
  })

  const elapsed = Date.now() - start
  assert.equal(result.status, 'timeout')
  assert.ok(result.summary.includes('TIMEOUT'))
  assert.ok(elapsed < 800, `Execution should abort near 60ms, took ${elapsed}ms`)
})

test('verify-service: slow telemetry readPoint beyond timeoutMs aborts and returns timeout status', async () => {
  // Mock telemetryReader where readPoint hangs
  const mockTelemetryReader = {
    readPoint: async () => {
      await new Promise((resolve) => setTimeout(resolve, 1500))
      return { value: 42, quality: 'good', timestamp: Date.now() }
    },
    subscribePoints: () => () => {},
  }

  const verifyService = createVerifyService({
    telemetryReader: mockTelemetryReader,
  })

  const start = Date.now()
  const result = await verifyService.runVerification({
    scenario: {
      id: 'sc-point-timeout',
      name: 'Hanging Telemetry Scenario',
      timeoutMs: 60,
      assertions: [
        {
          type: 'modbus.point',
          pointId: 'p_temp',
          operator: '==',
          expected: 42,
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
  })

  const elapsed = Date.now() - start
  assert.equal(result.status, 'timeout')
  assert.ok(result.summary.includes('TIMEOUT'))
  assert.ok(elapsed < 800, `Execution should abort near 60ms, took ${elapsed}ms`)
})
