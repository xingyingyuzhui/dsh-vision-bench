// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { TargetLeaseManager, createTargetKey } from '../../src/domain/debug/target-lease.mjs'

test('target lease: probe serial derives strong hardware target key', () => {
  const strong = createTargetKey({
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f1x',
    probeSerial: '066BFF543833484270671924',
    workspaceCwd: '/work',
  })

  assert.equal(strong.identityStrength, 'strong')
  assert.equal(strong.key, 'gdb-openocd:cmsis-dap:066BFF543833484270671924')

  const weak = createTargetKey({
    backend: 'gdb-openocd',
    interfaceName: 'cmsis-dap',
    target: 'stm32f1x',
    workspaceCwd: '/work',
  })

  assert.equal(weak.identityStrength, 'weak')
  assert.equal(weak.key, 'gdb-openocd:cmsis-dap:GLOBAL')
})

test('target lease: supports multiple simultaneous probes with distinct serials in same workspace', () => {
  const manager = new TargetLeaseManager()

  const lease1 = manager.acquireLease(
    {
      backend: 'gdb-openocd',
      interfaceName: 'stlink',
      target: 'stm32f4x',
      probeSerial: 'SERIAL_PROBE_A',
    },
    {
      sessionId: 'sess_1',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/common/workspace',
    },
  )

  const lease2 = manager.acquireLease(
    {
      backend: 'gdb-openocd',
      interfaceName: 'stlink',
      target: 'stm32f4x',
      probeSerial: 'SERIAL_PROBE_B',
    },
    {
      sessionId: 'sess_2',
      ownerSessionId: 'owner_1',
      workspaceCwd: '/common/workspace',
    },
  )

  assert.notEqual(lease1.targetKey, lease2.targetKey)

  // A third session attempting to acquire PROBE_A fails with TARGET_BUSY
  assert.throws(
    () =>
      manager.acquireLease(
        {
          backend: 'gdb-openocd',
          interfaceName: 'stlink',
          target: 'stm32f4x',
          probeSerial: 'SERIAL_PROBE_A',
        },
        {
          sessionId: 'sess_3',
          ownerSessionId: 'owner_2',
          workspaceCwd: '/common/workspace',
        },
      ),
    /调试目标已被其他会话占用/,
  )

  // Releasing lease1 allows sess_3 to acquire
  manager.releaseLease('sess_1', 'owner_1')
  const lease3 = manager.acquireLease(
    {
      backend: 'gdb-openocd',
      interfaceName: 'stlink',
      target: 'stm32f4x',
      probeSerial: 'SERIAL_PROBE_A',
    },
    {
      sessionId: 'sess_3',
      ownerSessionId: 'owner_2',
      workspaceCwd: '/common/workspace',
    },
  )
  assert.equal(lease3.sessionId, 'sess_3')
})
