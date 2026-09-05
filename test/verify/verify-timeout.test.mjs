import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'

test('verify-service: timeoutMs triggers hard wall-clock abort and returns status: timeout', async () => {
  const verifyService = createVerifyService()

  const start = Date.now()
  const result = await verifyService.runVerification({
    scenario: {
      name: 'Long Running Setup Scenario',
      timeoutMs: 80, // strict 80ms timeout
      setup: {
        delayMs: 2000, // setup delay exceeds timeout
      },
      assertions: [
        {
          type: 'no.alarm',
        },
      ],
    },
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-timeout',
  })

  const elapsed = Date.now() - start
  assert.equal(result.status, 'timeout')
  assert.ok(result.summary.includes('TIMEOUT'))
  assert.ok(elapsed < 1000, `Execution should abort near 80ms, took ${elapsed}ms`)
})
