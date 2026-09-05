// @ts-check
import assert from 'node:assert/strict'
import { unlink, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDebugApprovalStore } from '../../src/application/debug/debug-approval-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { startDebugSession } from '../../src/application/debug/debug-start-service.mjs'
import { DEBUG_ERRORS } from '../../src/domain/debug/errors.mjs'
import { buildOpenOcdDebugArgs } from '../../src/infrastructure/debug/openocd/openocd-debug-profile.mjs'
import { createDebugRpcHandler } from '../../src/interfaces/rpc/debug-rpc-handler.mjs'

test('F01: Unapproved ticket in pending state cannot be directly used for start', async () => {
  const dummyAxf = join(tmpdir(), `test_f01_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('TEST_AXF_BINARY'))

  const approvalStore = createDebugApprovalStore()
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      kind: 'fake',
      start: async () => {},
      stop: async () => {},
      command: async () => ({ ok: true }),
      subscribe: () => () => {},
    }),
  })

  try {
    // 1. Agent requests start without ticket -> returns needsApproval: true with ticket
    const req1 = await startDebugSession(
      {
        sessionId: 'session_f01',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(req1.ok, false)
    assert.equal(req1.needsApproval, true)
    const ticketId = req1.approval?.id
    assert.ok(ticketId)

    // Verify ticket status is 'pending'
    const pendingTicket = approvalStore.getPending(ticketId)
    assert.equal(pendingTicket?.status, 'pending')

    // 2. Second request re-submits ticketId directly WITHOUT user approving it in UI
    const req2 = await startDebugSession(
      {
        sessionId: 'session_f01',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        approvalRequestId: ticketId,
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    // MUST be rejected because ticket is still 'pending'
    assert.equal(req2.ok, false)
    assert.equal(req2.errorCode, DEBUG_ERRORS.APPROVAL_REQUIRED)
    assert.equal(req2.needsApproval, true)

    // 3. User approves ticket in UI
    const approveRes = approvalStore.approve(ticketId, { sessionId: 'session_f01', cwd: tmpdir() })
    assert.equal(approveRes.ok, true)
    assert.equal(approveRes.record?.status, 'approved')

    // 4. Now start with approved ticketId succeeds
    const req3 = await startDebugSession(
      {
        sessionId: 'session_f01',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        approvalRequestId: ticketId,
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(req3.ok, true)
    assert.ok(req3.debugSessionId)

    // 5. Repeated attempt with already consumed ticket fails
    const req4 = await startDebugSession(
      {
        sessionId: 'session_f01',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        approvalRequestId: ticketId,
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(req4.ok, false)
    assert.equal(req4.errorCode, DEBUG_ERRORS.APPROVAL_NOT_FOUND)

    await runtime.shutdown()
  } finally {
    await unlink(dummyAxf).catch(() => {})
  }
})

test('F02: UI approve RPC route runs fingerprint verification and detects firmware drift', async () => {
  const dummyAxf = join(tmpdir(), `test_f02_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('ORIGINAL_FIRMWARE_V1'))

  const approvalStore = createDebugApprovalStore()
  const runtime = createDebugRuntime({
    backendFactory: async () => ({
      kind: 'fake',
      start: async () => {},
      stop: async () => {},
      command: async () => ({ ok: true }),
      subscribe: () => () => {},
    }),
  })
  const rpcHandler = createDebugRpcHandler({
    debugRuntime: runtime,
    approvalStore,
  })

  try {
    // 1. Generate pending ticket for original firmware
    const req1 = await startDebugSession(
      {
        sessionId: 'session_f02',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )
    assert.equal(req1.ok, false)
    assert.equal(req1.needsApproval, true)
    const ticketId = req1.approval?.id
    assert.ok(ticketId)

    // 2. Modify firmware on disk before UI user approves
    await writeFile(dummyAxf, Buffer.from('MODIFIED_FIRMWARE_V2_DRIFT'))

    // 3. User approves in UI via debug/approval RPC
    const uiApproveRes = await rpcHandler('debug/approval', {
      cwd: tmpdir(),
      sessionId: 'session_f02',
      op: 'approve',
      requestId: ticketId,
    })

    // Must be rejected with APPROVAL_STALE because firmware drifted
    assert.equal(uiApproveRes.ok, false)
    assert.equal(uiApproveRes.errorCode, DEBUG_ERRORS.APPROVAL_STALE)

    await runtime.shutdown()
  } finally {
    await unlink(dummyAxf).catch(() => {})
  }
})

test('F09: probeSerial is included as adapter serial in OpenOCD launch arguments', () => {
  const argsWithoutSerial = buildOpenOcdDebugArgs({
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    gdbPort: 3333,
  })
  assert.equal(argsWithoutSerial.ok, true)
  if (argsWithoutSerial.ok) {
    assert.ok(!argsWithoutSerial.args.includes('adapter serial'))
  }

  const argsWithSerial = buildOpenOcdDebugArgs({
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    probeSerial: '0700000100260027',
    gdbPort: 4444,
  })
  assert.equal(argsWithSerial.ok, true)
  if (argsWithSerial.ok) {
    const joined = argsWithSerial.args.join(' ')
    assert.ok(joined.includes('adapter serial "0700000100260027"'))
  }
})
