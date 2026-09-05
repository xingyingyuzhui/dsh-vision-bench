// @ts-check
import assert from 'node:assert/strict'
import { rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDebugApprovalStore } from '../../src/application/debug/debug-approval-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { startDebugSession } from '../../src/application/debug/debug-start-service.mjs'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'

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
