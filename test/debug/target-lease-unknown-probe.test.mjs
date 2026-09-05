// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'
import { TargetLeaseManager, createTargetKey } from '../../src/domain/debug/target-lease.mjs'

test('PR-2: TargetLease: same interface + no serial + different cwd -> second gets TARGET_BUSY', () => {
  const manager = new TargetLeaseManager()

  const specWorkspaceA = {
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    workspaceCwd: '/workspace/project-alpha',
    // probeSerial is undefined
  }

  const specWorkspaceB = {
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f1x', // Even different target chip!
    workspaceCwd: '/workspace/project-beta',
    // probeSerial is undefined
  }

  // Verify target keys derived for unknown probes are interface-global
  const keyA = createTargetKey(specWorkspaceA)
  const keyB = createTargetKey(specWorkspaceB)
  assert.equal(keyA.key, 'gdb-openocd:cmsis-dap:GLOBAL')
  assert.equal(keyB.key, 'gdb-openocd:cmsis-dap:GLOBAL')
  assert.equal(keyA.identityStrength, 'weak')
  assert.equal(keyB.identityStrength, 'weak')

  // 1. First session acquires lease on cmsis-dap interface in workspace A
  const lease1 = manager.acquireLease(specWorkspaceA, {
    sessionId: 'session-alpha',
    ownerSessionId: 'user-1',
    workspaceCwd: '/workspace/project-alpha',
  })
  assert.equal(lease1.sessionId, 'session-alpha')
  assert.equal(lease1.targetKey, 'gdb-openocd:cmsis-dap:GLOBAL')

  // 2. Second session in different workspace B with same interface (no serial) attempts acquire -> TARGET_BUSY
  assert.throws(
    () => {
      manager.acquireLease(specWorkspaceB, {
        sessionId: 'session-beta',
        ownerSessionId: 'user-2',
        workspaceCwd: '/workspace/project-beta',
      })
    },
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.TARGET_BUSY)
      assert.equal(err.details.targetKey, 'gdb-openocd:cmsis-dap:GLOBAL')
      assert.equal(err.details.currentSessionId, 'session-alpha')
      return true
    },
  )

  // 3. Different interface (e.g. jlink) can be acquired simultaneously
  const leaseJlink = manager.acquireLease(
    {
      backend: 'gdb-openocd',
      interfaceName: 'jlink',
      target: 'stm32f4x',
      workspaceCwd: '/workspace/project-beta',
    },
    {
      sessionId: 'session-beta',
      ownerSessionId: 'user-2',
      workspaceCwd: '/workspace/project-beta',
    },
  )
  assert.equal(leaseJlink.targetKey, 'gdb-openocd:jlink:GLOBAL')

  // 4. Once session-alpha releases cmsis-dap, session-beta can acquire it
  manager.releaseLease('session-alpha', 'user-1')
  const lease2 = manager.acquireLease(specWorkspaceB, {
    sessionId: 'session-beta-retry',
    ownerSessionId: 'user-2',
    workspaceCwd: '/workspace/project-beta',
  })
  assert.equal(lease2.sessionId, 'session-beta-retry')
})
