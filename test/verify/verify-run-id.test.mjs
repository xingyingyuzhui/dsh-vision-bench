import assert from 'node:assert/strict'
import test from 'node:test'
import { createVerifyCommandService } from '../../src/application/verify/verify-command-service.mjs'
import { createVerifyService } from '../../src/application/verify/verify-service.mjs'

test('verify-command-service: generates unique verificationRunId and supports parallel runs of same scenario', async () => {
  const mockWorkspace = {
    modbus: {
      points: [{ id: 'p1', name: 'Pressure' }],
      alarmState: {},
    },
  }
  const verifyService = createVerifyService({
    workspaceLoader: () => mockWorkspace,
  })
  const cmdService = createVerifyCommandService({ verifyService })

  const scenario = {
    id: 'common_check',
    name: 'Common Check',
    setup: {
      delayMs: 60,
    },
    assertions: [
      {
        type: 'no.alarm',
      },
    ],
  }

  // Launch two runs of the exact same scenario concurrently
  const promise1 = cmdService.execute({
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
    scenario,
  })

  const promise2 = cmdService.execute({
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
    scenario,
  })

  const [res1, res2] = await Promise.all([promise1, promise2])

  // Both runs must have unique run IDs starting with vr_
  assert.ok(res1.verificationRunId.startsWith('vr_'))
  assert.ok(res2.verificationRunId.startsWith('vr_'))
  assert.notEqual(res1.verificationRunId, res2.verificationRunId)
  assert.equal(res1.status, 'pass')
  assert.equal(res2.status, 'pass')

  // Both results must be retrievable by their respective verificationRunId
  const retrieved1 = cmdService.getResult(res1.verificationRunId)
  const retrieved2 = cmdService.getResult(res2.verificationRunId)
  assert.equal(retrieved1?.verificationRunId, res1.verificationRunId)
  assert.equal(retrieved2?.verificationRunId, res2.verificationRunId)
})

test('verify-command-service: cancellation by verificationRunId isolates target run', async () => {
  const mockWorkspace = {
    modbus: {
      points: [{ id: 'p1', name: 'Pressure' }],
      alarmState: {},
    },
  }
  const verifyService = createVerifyService({
    workspaceLoader: () => mockWorkspace,
  })
  const cmdService = createVerifyCommandService({ verifyService })

  const scenario = {
    id: 'cancel_target',
    name: 'Cancel Target Scenario',
    setup: {
      delayMs: 200,
    },
    assertions: [
      {
        type: 'no.alarm',
      },
    ],
  }

  const run1Promise = cmdService.execute({
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
    scenario,
    verificationRunId: 'vr_run_1',
  })

  const run2Promise = cmdService.execute({
    workspaceCwd: '/test/cwd',
    ownerSessionId: 'sess-1',
    scenario,
    verificationRunId: 'vr_run_2',
  })

  // Cancel only run 1 by its verificationRunId
  const cancelled = cmdService.cancel('vr_run_1')
  assert.equal(cancelled, true)

  const [res1, res2] = await Promise.all([run1Promise, run2Promise])

  assert.equal(res1.status, 'cancelled')
  assert.equal(res2.status, 'pass')
})
