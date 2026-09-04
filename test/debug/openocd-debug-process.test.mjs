import assert from 'node:assert/strict'
import test from 'node:test'
import { OPENOCD_GDB_READY_REGEX } from '../../src/infrastructure/debug/openocd/openocd-debug-process.mjs'
import { buildOpenOcdDebugArgs } from '../../src/infrastructure/debug/openocd/openocd-debug-profile.mjs'

test('buildOpenOcdDebugArgs builds valid args for standard interface and target', () => {
  const built = buildOpenOcdDebugArgs({
    interfaceName: 'stlink',
    target: 'stm32f4x',
    gdbPort: 3333,
  })
  assert.equal(built.ok, true)
  if (built.ok) {
    assert.equal(built.port, 3333)
    assert.deepEqual(built.args, [
      '-f',
      'interface/stlink.cfg',
      '-f',
      'target/stm32f4x.cfg',
      '-c',
      'gdb_port 3333; telnet_port disabled; tcl_port disabled',
    ])
  }
})

test('buildOpenOcdDebugArgs rejects unallowed interface or target', () => {
  const badIface = buildOpenOcdDebugArgs({
    interfaceName: '../unsafe/iface',
    target: 'stm32f4x',
  })
  assert.equal(badIface.ok, false)

  const badTarget = buildOpenOcdDebugArgs({
    interfaceName: 'stlink',
    target: '../../etc/passwd',
  })
  assert.equal(badTarget.ok, false)
})

test('OPENOCD_GDB_READY_REGEX detects ready lines accurately', () => {
  assert.equal(OPENOCD_GDB_READY_REGEX.test('Info : Listening on port 3333 for gdb connections'), true)
  assert.equal(OPENOCD_GDB_READY_REGEX.test('Listening on port 3334 for GDB connections'), true)
  assert.equal(OPENOCD_GDB_READY_REGEX.test('Info : clock speed 2000 kHz'), false)
})
