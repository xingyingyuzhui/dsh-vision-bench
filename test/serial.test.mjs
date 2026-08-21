import assert from 'node:assert/strict'
import test from 'node:test'
import {
  listSerialPorts,
  listUnixPortsFromNames,
  parseJsonStringList,
  parsePnpPortLabels,
  parseRegSerialComm,
  serialDevicePath,
} from '../bench-serial.mjs'

test('serialDevicePath keeps COM1-9 and prefixes COM10+', () => {
  assert.equal(serialDevicePath('COM3'), 'COM3')
  assert.equal(serialDevicePath('com7'), 'COM7')
  assert.equal(serialDevicePath('COM10'), '\\\\.\\COM10')
  assert.equal(serialDevicePath('\\\\.\\COM12'), '\\\\.\\COM12')
  assert.equal(serialDevicePath('/dev/ttyUSB0'), '/dev/ttyUSB0')
})

test('parseRegSerialComm reads REG_SZ COM values', () => {
  const text = [
    'HKEY_LOCAL_MACHINE\\HARDWARE\\DEVICEMAP\\SERIALCOMM',
    '    \\Device\\Serial0    REG_SZ    COM1',
    '    \\Device\\VCP0    REG_SZ    COM3',
    '    \\Device\\Silabser0    REG_SZ    COM10',
  ].join('\n')
  assert.deepEqual(parseRegSerialComm(text), ['COM1', 'COM3', 'COM10'])
})

test('parseJsonStringList accepts one or many COM names', () => {
  assert.deepEqual(parseJsonStringList('"COM3"'), ['COM3'])
  assert.deepEqual(parseJsonStringList('["COM5","COM3"]'), ['COM3', 'COM5'])
  assert.deepEqual(parseJsonStringList('COM4\nCOM2'), ['COM2', 'COM4'])
})

test('parsePnpPortLabels maps (COMx) friendly names', () => {
  const labels = parsePnpPortLabels(JSON.stringify([
    { Name: 'USB-SERIAL CH340 (COM3)' },
    { Name: '通信端口 (COM1)' },
  ]))
  assert.equal(labels.COM3, 'USB-SERIAL CH340 (COM3)')
  assert.equal(labels.COM1, '通信端口 (COM1)')
})

test('listUnixPortsFromNames keeps USB serial and drops Bluetooth', () => {
  const ports = listUnixPortsFromNames([
    'cu.Bluetooth-Incoming-Port',
    'cu.usbserial-110',
    'cu.usbmodem14101',
    'ttyUSB0',
    'ttyS0',
  ])
  assert.deepEqual(ports.map((item) => item.path), [
    '/dev/cu.usbmodem14101',
    '/dev/cu.usbserial-110',
    '/dev/ttyUSB0',
  ])
})

test('listSerialPorts on win32 uses registry COM names', async () => {
  const ran = await listSerialPorts({
    platform: 'win32',
    execFile: async (bin) => {
      if (String(bin).replace(/\\/g, '/').endsWith('reg.exe')) {
        return { stdout: '    \\Device\\VCP0    REG_SZ    COM3\r\n    \\Device\\Serial0    REG_SZ    COM1\r\n' }
      }
      throw new Error('unexpected ' + bin)
    },
  })
  assert.equal(ran.ok, true)
  assert.equal(ran.ports.length, 2)
  assert.equal(ran.ports[0].path, 'COM1')
  assert.equal(ran.ports[1].path, 'COM3')
  assert.equal(ran.ports[1].label, 'COM3')
})

test('listSerialPorts on darwin uses injected /dev names', async () => {
  const ran = await listSerialPorts({
    platform: 'darwin',
    readdir: () => ['cu.usbserial-110', 'cu.Bluetooth-Incoming-Port'],
  })
  assert.equal(ran.ok, true)
  assert.equal(ran.ports.length, 1)
  assert.equal(ran.ports[0].path, '/dev/cu.usbserial-110')
})
