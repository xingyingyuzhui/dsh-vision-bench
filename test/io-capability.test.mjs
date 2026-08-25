import assert from 'node:assert/strict'
import test from 'node:test'
import { canUseModbus, canUseSerialMonitor, ioRuntimeStatus, idleIoSnapshot, capabilitiesFromHealth } from '../bench-io-capability.mjs'

test('idle/unknown allows first Modbus and serial operation', () => {
  const idle = idleIoSnapshot()
  assert.equal(canUseModbus(idle, 'rtu'), true)
  assert.equal(canUseModbus(idle, 'tcp'), true)
  assert.equal(canUseSerialMonitor(idle), true)
  assert.equal(ioRuntimeStatus(idle, 'rtu').value, 'unknown')
  assert.equal(ioRuntimeStatus(idle, 'rtu').labelKey, 'ioPending')
})

test('simulated Modbus is always allowed even if runtime is unavailable', () => {
  const down = {
    state: 'unhealthy',
    capabilities: { modbusTcp: 'unavailable', modbusRtu: 'unavailable', serialMonitor: 'unavailable' },
  }
  assert.equal(canUseModbus(down, 'rtu', { simulated: true }), true)
  assert.equal(canUseModbus(down, 'rtu'), false)
  assert.equal(canUseSerialMonitor(down), false)
})

test('TCP unavailability does not disable RTU', () => {
  const mixed = {
    state: 'ready',
    capabilities: { modbusTcp: 'unavailable', modbusRtu: 'ready', serialMonitor: 'ready' },
  }
  assert.equal(canUseModbus(mixed, 'tcp'), false)
  assert.equal(canUseModbus(mixed, 'rtu'), true)
  assert.equal(canUseSerialMonitor(mixed), true)
})

test('python binding is not part of capability snapshot', () => {
  const idle = idleIoSnapshot()
  assert.equal('python' in idle, false)
  assert.deepEqual(Object.keys(idle.capabilities).sort(), ['modbusRtu', 'modbusTcp', 'serialMonitor'])
})

test('health payload maps tcp/rtu independently', () => {
  const caps = capabilitiesFromHealth({ tcp: true, rtu: false, rtuError: 'no native' })
  assert.equal(caps.modbusTcp, 'ready')
  assert.equal(caps.modbusRtu, 'unavailable')
  assert.equal(caps.serialMonitor, 'unavailable')
})
