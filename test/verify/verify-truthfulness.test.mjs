// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'
import { evaluateAssertion } from '../../src/domain/verify/assertion.mjs'

test('verify-service: no.exception fails when no debug session is active', async () => {
  const verifyService = createVerifyService({
    debugRuntime: {
      findSession: () => null,
      state: () => null,
      command: async () => ({}),
    },
  })

  const result = await verifyService.runVerification({
    scenario: {
      id: 'sc-no-ex',
      name: 'No Exception Test',
      timeoutMs: 1000,
      assertions: [
        {
          type: 'no.exception',
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-no-dbg',
  })

  assert.equal(result.status, 'fail', 'Must fail when debug session is not active')
  assert.equal(result.assertions.length, 1)
  assert.equal(result.assertions[0].pass, false)
  assert.equal(result.assertions[0].actual, 'NO_DEBUG_SESSION')
})

test('verify-service: no.alarm fails when no alarm source exists', async () => {
  const verifyService = createVerifyService({
    workspaceLoader: () => ({
      modbus: {
        // missing alarmState and alarms
      },
    }),
  })

  const result = await verifyService.runVerification({
    scenario: {
      id: 'sc-no-alm-source',
      name: 'No Alarm Source Test',
      timeoutMs: 1000,
      assertions: [
        {
          type: 'no.alarm',
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-test',
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.assertions[0].pass, false)
  assert.equal(result.assertions[0].actual, 'NO_ALARM_SOURCE')
})

test('verify-service: no.alarm fails when active alarms are reported', async () => {
  const verifyService = createVerifyService({
    workspaceLoader: () => ({
      modbus: {
        alarmState: {
          'alm-1': { condition: 'active' },
        },
      },
    }),
  })

  const result = await verifyService.runVerification({
    scenario: {
      id: 'sc-active-alm',
      name: 'Active Alarm Test',
      timeoutMs: 1000,
      assertions: [
        {
          type: 'no.alarm',
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-test',
  })

  assert.equal(result.status, 'fail')
  assert.equal(result.assertions[0].pass, false)
  assert.equal(result.assertions[0].actual, 1)
})

test('evaluateAssertion: stable-for-duration fails on empty, single, or non-finite samples', () => {
  // Empty samples
  const emptyRes = evaluateAssertion({ type: 'stable-for-duration', durationMs: 500 }, [])
  assert.equal(emptyRes.pass, false)
  assert.ok(emptyRes.message.includes('采样不足') || emptyRes.message.includes('insufficient'))

  // Single sample
  const singleRes = evaluateAssertion({ type: 'stable-for-duration', durationMs: 500 }, [42])
  assert.equal(singleRes.pass, false)
  assert.ok(singleRes.message.includes('采样不足'))

  // Non-finite (NaN / null)
  const nanRes = evaluateAssertion({ type: 'stable-for-duration', durationMs: 500 }, [NaN, NaN])
  assert.equal(nanRes.pass, false)

  // Valid finite samples within tolerance
  const validRes = evaluateAssertion(
    { type: 'stable-for-duration', durationMs: 500, tolerance: 0.1 },
    [10.0, 10.05, 9.98],
  )
  assert.equal(validRes.pass, true)
})
