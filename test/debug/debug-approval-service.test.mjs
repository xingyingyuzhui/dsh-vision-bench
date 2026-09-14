// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearDebugApprovals,
  createDebugApprovalStore,
  defaultDebugApprovals,
} from '../../src/application/debug/debug-approval-service.mjs'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { executeDebugCommand } from '../../src/application/debug/debug-command-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { startDebugSession } from '../../src/application/debug/debug-start-service.mjs'
import { DEBUG_ERRORS } from '../../src/domain/debug/errors.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'

test('debug-approval-service: create, listPending, and consume ticket lifecycle', () => {
  let currentTime = 1000
  const store = createDebugApprovalStore({
    ttlMs: 5000,
    now: () => currentTime,
  })

  // 1. Create ticket
  const ticket = store.create({
    cwd: '/workspace/stm32',
    sessionId: 'sess_alice',
    source: 'agent',
    backend: 'gdb-openocd',
    target: 'stm32f4x',
    interfaceName: 'stlink',
    artifactPath: '/build/firmware.elf',
    artifactSha256: 'abc123hash',
  })

  assert.ok(ticket.requestId.startsWith('da_'))
  assert.equal(ticket.cwd, '/workspace/stm32')
  assert.equal(ticket.sessionId, 'sess_alice')
  assert.equal(ticket.source, 'agent')
  assert.equal(ticket.target, 'stm32f4x')
  assert.equal(ticket.createdAt, 1000)
  assert.equal(ticket.expiresAt, 6000)
  assert.equal(ticket.risk, '允许对目标设备进行 halt/run/step/reset 操作')

  // 2. listPending scoped
  const pendingAlice = store.listPending({ cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(pendingAlice.length, 1)
  assert.equal(pendingAlice[0].requestId, ticket.requestId)

  const pendingBob = store.listPending({ cwd: '/workspace/stm32', sessionId: 'sess_bob' })
  assert.equal(pendingBob.length, 0)

  // 3. getPending without consuming
  const fetched = store.getPending(ticket.requestId)
  assert.ok(fetched)
  assert.equal(fetched?.requestId, ticket.requestId)
  assert.equal(store.size(), 1)

  // 4. Scope mismatch rejection
  const mismatchRes = store.consume(ticket.requestId, { cwd: '/workspace/other', sessionId: 'sess_alice' })
  assert.equal(mismatchRes.ok, false)
  assert.equal(mismatchRes.errorCode, DEBUG_ERRORS.APPROVAL_SCOPE_MISMATCH)
  assert.equal(store.size(), 1, 'ticket must not be consumed on scope mismatch')

  // 5. Successful consume
  const appRes = store.approve(ticket.requestId, { cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(appRes.ok, true)
  const consumeRes = store.consume(ticket.requestId, { cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(consumeRes.ok, true)
  assert.equal(consumeRes.record?.requestId, ticket.requestId)
  assert.equal(store.size(), 0)

  // 6. Repeat consume fails (one-shot)
  const repeatRes = store.consume(ticket.requestId, { cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(repeatRes.ok, false)
  assert.equal(repeatRes.errorCode, DEBUG_ERRORS.APPROVAL_NOT_FOUND)
})

test('debug-approval-service: expiration removes ticket and returns APPROVAL_EXPIRED', () => {
  let currentTime = 1000
  const store = createDebugApprovalStore({
    ttlMs: 2000,
    now: () => currentTime,
  })

  const ticket = store.create({
    cwd: '/workspace/test',
    sessionId: 'sess_exp',
  })

  // Advance time beyond expiration
  currentTime = 3500

  const res = store.consume(ticket.requestId, { cwd: '/workspace/test', sessionId: 'sess_exp' })
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, DEBUG_ERRORS.APPROVAL_EXPIRED)
  assert.equal(store.size(), 0)
})

test('debug-approval-service: control lease grant, query, and revoke', () => {
  const store = createDebugApprovalStore()

  assert.equal(store.hasControlLease('ds_123'), false)

  store.grantControlLease('ds_123', {
    ownerSessionId: 'sess_owner',
    workspaceCwd: '/workspace/app',
    artifactSha256: 'sha_fixed',
    backend: 'gdb-openocd',
    target: 'stm32',
  })

  assert.equal(store.hasControlLease('ds_123'), true)
  assert.equal(store.hasControlLease('ds_123', { ownerSessionId: 'sess_owner' }), true)
  assert.equal(store.hasControlLease('ds_123', { ownerSessionId: 'sess_intruder' }), false)
  assert.equal(store.hasControlLease('ds_123', { artifactSha256: 'sha_fixed' }), true)
  assert.equal(store.hasControlLease('ds_123', { artifactSha256: 'sha_changed' }), false)

  store.revokeControlLease('ds_123')
  assert.equal(store.hasControlLease('ds_123'), false)
})

test('debug-approval-service: capacity eviction and clear', () => {
  const store = createDebugApprovalStore({ max: 3 })
  const t1 = store.create({ cwd: '/a', sessionId: 's' })
  const t2 = store.create({ cwd: '/b', sessionId: 's' })
  const t3 = store.create({ cwd: '/c', sessionId: 's' })
  assert.equal(store.size(), 3)

  // 4th creates causes eviction of oldest
  const t4 = store.create({ cwd: '/d', sessionId: 's' })
  assert.equal(store.size(), 3)
  assert.equal(store.getPending(t1.requestId), null)
  assert.ok(store.getPending(t4.requestId))

  store.clear()
  assert.equal(store.size(), 0)
})

test('debug-approval-service: default singleton clear works', () => {
  defaultDebugApprovals.create({ cwd: '/test', sessionId: 's' })
  assert.ok(defaultDebugApprovals.size() > 0)
  clearDebugApprovals()
  assert.equal(defaultDebugApprovals.size(), 0)
})

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

test('PR-2: Debug approval ticket is invalidated with DEBUG_APPROVAL_STALE when firmware artifact changes', async () => {
  const dummyAxf = join(tmpdir(), `stale_test_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FIRMWARE_V1'))

  try {
    const runtime = createDebugRuntime({
      backendFactory: async () => ({
        async start() {},
        async stop() {},
      }),
    })
    const approvalStore = createDebugApprovalStore()

    // 1. Agent requests debug start (creates approval ticket with V1 fingerprint)
    const reqRes = await startDebugSession(
      {
        sessionId: 'agent_session_stale',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(reqRes.ok, false)
    assert.equal(reqRes.needsApproval, true)
    const ticketId = reqRes.approval.id
    assert.ok(ticketId)

    // 2. User approves ticket in UI
    approvalStore.approve(ticketId)

    // 3. Firmware artifact changes before agent launches
    await writeFile(dummyAxf, Buffer.from('FIRMWARE_V2_CHANGED_CODE'))

    // 4. Agent attempts start with approvalRequestId
    const staleRes = await startDebugSession(
      {
        sessionId: 'agent_session_stale',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        approvalRequestId: ticketId,
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(staleRes.ok, false)
    assert.equal(staleRes.errorCode, DEBUG_ERRORS.APPROVAL_STALE)
    assert.match(staleRes.error, /已发生变化/)
    assert.equal(staleRes.needsApproval, true)

    // 5. Verify the ticket was invalidated (no longer in pending store)
    const pending = approvalStore.listPending({ cwd: tmpdir(), sessionId: 'agent_session_stale' })
    assert.equal(pending.length, 0)
    assert.equal(approvalStore.getPending(ticketId), null)

    // 6. Verify session was never started
    const activeSession = runtime.findSession((s) => s.ownerSessionId === 'agent_session_stale')
    assert.equal(activeSession, null)

    await runtime.shutdown()
  } finally {
    await rm(dummyAxf, { force: true }).catch(() => {})
  }
})

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
