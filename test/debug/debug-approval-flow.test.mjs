// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import { createDebugApprovalStore } from '../../src/application/debug/debug-approval-service.mjs'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { DEBUG_ERRORS } from '../../src/domain/debug/errors.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'

test('debug-approval-flow: end-to-end agent start approval, rejection, approve, and subsequent execution', async () => {
  let startedCount = 0
  let pausedCount = 0
  let steppedCount = 0

  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      async start() {
        startedCount++
      },
      async stop() {},
      async pause() {
        pausedCount++
      },
      async step() {
        steppedCount++
      },
    }),
  })
  const approvalStore = createDebugApprovalStore()
  const rpcHandler = createDebugRpcHandler({ debugRuntime: runtime, approvalStore })

  const scope = { cwd: '/workspace/embedded', sessionId: 'sess_agent_1' }

  // 1. Agent calls start without approval -> returns APPROVAL_REQUIRED
  const agentStartRes = await executeDebugCommand(
    {
      action: 'debug.start',
      source: 'agent',
      ...scope,
      payload: {
        backend: 'gdb-openocd',
        targetSpec: {
          target: 'stm32f4x',
          interfaceName: 'stlink',
          artifactPath: '/build/fw.elf',
          artifactSha256: 'sha256_mock_123',
        },
      },
    },
    { debugRuntime: runtime, approvalStore },
  )

  assert.equal(agentStartRes.ok, false)
  assert.equal(agentStartRes.errorCode, DEBUG_ERRORS.APPROVAL_REQUIRED)
  assert.equal(agentStartRes.needsApproval, true)
  assert.ok(agentStartRes.approval?.requestId)
  assert.equal(startedCount, 0, 'backend must not start before approval')

  const reqId1 = agentStartRes.approval.requestId

  // 2. Browser queries pending approvals via debug/approval op=list or debug/state
  const listRes = await rpcHandler('debug/approval', { op: 'list', ...scope })
  assert.equal(listRes.ok, true)
  assert.equal(listRes.pending.length, 1)
  assert.equal(listRes.pending[0].requestId, reqId1)

  const stateRes = await rpcHandler('debug/state', scope)
  assert.equal(stateRes.ok, true)
  assert.equal(stateRes.active, false)
  assert.equal(stateRes.pendingApprovals.length, 1)

  // 3. User rejects the ticket
  const rejectRes = await rpcHandler('debug/approval', { op: 'reject', requestId: reqId1, ...scope })
  assert.equal(rejectRes.ok, true)
  assert.equal(rejectRes.rejected, true)

  const listAfterReject = await rpcHandler('debug/approval', { op: 'list', ...scope })
  assert.equal(listAfterReject.pending.length, 0)

  // 4. Agent initiates start again -> new approval ticket generated
  const agentStartRes2 = await executeDebugCommand(
    {
      action: 'debug.start',
      source: 'agent',
      ...scope,
      payload: {
        backend: 'gdb-openocd',
        targetSpec: {
          target: 'stm32f4x',
          interfaceName: 'stlink',
          artifactPath: '/build/fw.elf',
          artifactSha256: 'sha256_mock_123',
        },
      },
    },
    { debugRuntime: runtime, approvalStore },
  )

  assert.equal(agentStartRes2.ok, false)
  assert.equal(agentStartRes2.errorCode, DEBUG_ERRORS.APPROVAL_REQUIRED)
  const reqId2 = agentStartRes2.approval.requestId

  // 5. User approves the ticket
  const approveRes = await rpcHandler('debug/approval', { op: 'approve', requestId: reqId2, ...scope })
  assert.equal(approveRes.ok, true)
  assert.equal(approveRes.approved, true)
  assert.ok(approveRes.debugSessionId)
  assert.equal(startedCount, 1)

  const debugSessionId = approveRes.debugSessionId
  assert.equal(approvalStore.hasControlLease(debugSessionId), true)

  // 6. Subsequent operations by Agent proceed without requiring approval
  const pauseRes = await executeDebugCommand(
    { action: 'debug.pause', source: 'agent', debugSessionId, ...scope },
    { debugRuntime: runtime, approvalStore },
  )
  assert.equal(pauseRes.ok, true)
  assert.equal(pauseRes.state, 'paused')
  assert.equal(pausedCount, 1)

  const stepRes = await executeDebugCommand(
    { action: 'debug.step', source: 'agent', debugSessionId, ...scope },
    { debugRuntime: runtime, approvalStore },
  )
  assert.equal(stepRes.ok, true)
  assert.equal(stepRes.state, 'paused')
  assert.equal(steppedCount, 1)

  // 7. Stop session revokes the control lease
  const stopRes = await executeDebugCommand(
    { action: 'debug.stop', source: 'agent', debugSessionId, ...scope },
    { debugRuntime: runtime, approvalStore },
  )
  assert.equal(stopRes.ok, true)
  assert.equal(approvalStore.hasControlLease(debugSessionId), false)
})
