import assert from 'node:assert/strict'
import test from 'node:test'
import { DEBUG_ERRORS, DebugError } from '../../src/domain/debug/errors.mjs'
import { TargetLeaseManager, createTargetKey } from '../../src/domain/debug/target-lease.mjs'

test('createTargetKey produces strong key with probeSerial and weak with cwd fallback', () => {
  const strong = createTargetKey({
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    probeSerial: '0700000123456789',
  })
  assert.equal(strong.identityStrength, 'strong')
  assert.equal(strong.key, 'gdb-openocd:cmsis-dap:stm32f4x:0700000123456789')

  const weak = createTargetKey({
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    workspaceCwd: '/workspace/board',
  })
  assert.equal(weak.identityStrength, 'weak')
  assert.equal(weak.key, 'gdb-openocd:cmsis-dap:stm32f4x:/workspace/board')
})

test('TargetLeaseManager acquires, verifies and enforces exclusivity', () => {
  const manager = new TargetLeaseManager()
  const spec = {
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f4x',
    probeSerial: 'SN-001',
  }

  const lease1 = manager.acquireLease(spec, {
    sessionId: 'session-1',
    ownerSessionId: 'user-sess-a',
    workspaceCwd: '/ws/1',
  })

  assert.equal(lease1.sessionId, 'session-1')
  assert.equal(lease1.ownerSessionId, 'user-sess-a')
  assert.equal(manager.verifyLease('session-1', lease1.targetKey), true)
  assert.equal(manager.verifyLease('session-2', lease1.targetKey), false)

  // Re-acquire by same session succeeds
  const reLease = manager.acquireLease(spec, {
    sessionId: 'session-1',
    ownerSessionId: 'user-sess-a',
    workspaceCwd: '/ws/1',
  })
  assert.equal(reLease.sessionId, 'session-1')

  // Competing session acquires same target -> DEBUG_TARGET_BUSY
  assert.throws(
    () =>
      manager.acquireLease(spec, {
        sessionId: 'session-2',
        ownerSessionId: 'user-sess-b',
        workspaceCwd: '/ws/2',
      }),
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.TARGET_BUSY)
      assert.equal(err.details.currentSessionId, 'session-1')
      return true
    },
  )

  // Release by foreign owner fails
  assert.throws(
    () => manager.releaseLease('session-1', 'user-sess-b'),
    (err) => {
      assert.ok(err instanceof DebugError)
      assert.equal(err.code, DEBUG_ERRORS.NOT_OWNER)
      return true
    },
  )

  // Release by owner succeeds
  assert.equal(manager.releaseLease('session-1', 'user-sess-a'), true)
  assert.equal(manager.verifyLease('session-1', lease1.targetKey), false)

  // Now session-2 can acquire
  const lease2 = manager.acquireLease(spec, {
    sessionId: 'session-2',
    ownerSessionId: 'user-sess-b',
    workspaceCwd: '/ws/2',
  })
  assert.equal(lease2.sessionId, 'session-2')
})
