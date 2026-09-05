import assert from 'node:assert/strict'
// @ts-check
import test from 'node:test'
import { createDebugApprovalStore } from '../../src/application/debug/debug-approval-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { startDebugSession } from '../../src/application/debug/debug-start-service.mjs'
import { DEBUG_ERRORS } from '../../src/domain/debug/errors.mjs'

test('PR-2: Agent approved=true bypass is rejected and requires approvalRequestId', async () => {
  const runtime = createDebugRuntime({
    backendFactory: () => ({ start: async () => {}, stop: async () => {} }),
  })
  const approvalStore = createDebugApprovalStore()

  // Spec resolver that returns resolved target spec
  const specResolver = async () => ({
    backend: 'gdb-openocd',
    targetSpec: {
      artifactPath: '/fake/build.axf',
      artifactSha256: 'deadbeef1234',
      interfaceName: 'stlink',
      target: 'stm32f4x',
      gdbPort: 3333,
    },
  })

  // Agent requests start with { approved: true } without approvalRequestId
  const res = await startDebugSession(
    {
      sessionId: 'agent_session_1',
      cwd: '/workspace',
      source: 'agent',
      approved: true, // Should be ignored!
    },
    {
      debugRuntime: runtime,
      approvalStore,
      specResolver,
    },
  )

  // Must still require approval ticket
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, DEBUG_ERRORS.APPROVAL_REQUIRED)
  assert.equal(res.needsApproval, true)
  assert.ok(res.approval?.requestId)
  assert.ok(res.approval?.launchFingerprint)
})
