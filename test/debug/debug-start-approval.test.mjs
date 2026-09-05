// @ts-check
import assert from 'node:assert/strict'
import { writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createDebugApprovalStore } from '../../src/application/debug/debug-approval-service.mjs'
import { createDebugRuntime } from '../../src/application/debug/debug-runtime.mjs'
import { startDebugSession } from '../../src/application/debug/debug-start-service.mjs'

test('debug start service: Agent requires approval card then starts when approved', async () => {
  const dummyAxf = join(tmpdir(), `agent_start_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FAKE ELF'))

  try {
    const runtime = createDebugRuntime({
      backendFactory: async () => ({
        async start() {},
        async stop() {},
      }),
    })
    const approvalStore = createDebugApprovalStore()

    // 1. Agent calls start without approval
    const unapproved = await startDebugSession(
      {
        sessionId: 'agent_session_1',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(unapproved.ok, false)
    assert.equal(unapproved.needsApproval, true)
    assert.ok(unapproved.approval?.id)

    // 2. User approves ticket in UI
    const ticketId = unapproved.approval.id
    approvalStore.approve(ticketId)

    // 3. Agent re-submits with approvalRequestId
    const approved = await startDebugSession(
      {
        sessionId: 'agent_session_1',
        cwd: tmpdir(),
        source: 'agent',
        backend: 'gdb-openocd',
        approvalRequestId: ticketId,
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(approved.ok, true)
    assert.ok(approved.debugSessionId)
    assert.equal(approved.session.state, 'ready')

    await runtime.shutdown()
  } finally {
    await writeFile(dummyAxf, '').catch(() => {})
  }
})

test('debug start service: user requests start immediately without approval ticket', async () => {
  const dummyAxf = join(tmpdir(), `user_start_${Date.now()}.axf`)
  await writeFile(dummyAxf, Buffer.from('FAKE ELF'))

  try {
    const runtime = createDebugRuntime({
      backendFactory: async () => ({
        async start() {},
        async stop() {},
      }),
    })
    const approvalStore = createDebugApprovalStore()

    const res = await startDebugSession(
      {
        sessionId: 'user_session_1',
        cwd: tmpdir(),
        source: 'user',
        backend: 'gdb-openocd',
        targetSpec: { artifactPath: dummyAxf },
      },
      { debugRuntime: runtime, approvalStore },
    )

    assert.equal(res.ok, true)
    assert.ok(res.debugSessionId)
    assert.equal(res.session.state, 'ready')

    await runtime.shutdown()
  } finally {
    await writeFile(dummyAxf, '').catch(() => {})
  }
})
