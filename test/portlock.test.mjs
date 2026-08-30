import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeTask } from '../bench-journal.mjs'
import { isPortBusy, portKey, withPortLock } from '../bench-portlock.mjs'
import { findMonitoredPort, openSerialMonitor } from '../bench-serial-monitor.mjs'

test('portKey normalizes device prefixes and case', async () => {
  assert.equal(portKey('\\\\.\\COM3'), 'COM3')
  assert.equal(portKey('com3'), 'COM3')
  assert.equal(portKey(' COM10 '), 'COM10')
  assert.equal(portKey('/dev/ttyUSB0'), '/DEV/TTYUSB0')
  assert.equal(portKey(''), '')
})

test('withPortLock serializes concurrent transactions on one port', async () => {
  const order = []
  const job = (name, ms) => () =>
    new Promise((resolve) => {
      order.push(name + '-start')
      setTimeout(() => {
        order.push(name + '-end')
        resolve(name)
      }, ms)
    })
  const [a, b] = await Promise.all([withPortLock('COM4', job('a', 40)), withPortLock('\\\\.\\com4', job('b', 5))])
  assert.equal(a, 'a')
  assert.equal(b, 'b')
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})

test('isPortBusy reflects in-flight transactions only', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const running = withPortLock('COM5', () => gate)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(isPortBusy('com5'), true)
  assert.equal(isPortBusy('COM6'), false)
  release()
  await running
  assert.equal(isPortBusy('COM5'), false)
})

test('frames layer cannot open a SerialPort; findMonitoredPort is retired', async () => {
  const opened = await openSerialMonitor('/tmp/ws', { port: 'COM7' })
  assert.equal(opened.ok, false)
  assert.equal(opened.code, 'USE_HMI_CONNECT')
  assert.equal(findMonitoredPort('COM7'), null)
})

test('normalizeTask caps frame payloads', async () => {
  const task = normalizeTask({
    type: 'read',
    status: 'ok',
    frames: {
      request: 'r'.repeat(500),
      response: 's'.repeat(500),
      trace: ['t'.repeat(500), '', 'ok'],
    },
  })
  assert.equal(task.frames.request.length, 200)
  assert.equal(task.frames.response.length, 200)
  assert.deepEqual(task.frames.trace, ['t'.repeat(200), 'ok'])
  const bare = normalizeTask({ type: 'read', status: 'ok' })
  assert.equal(bare.frames, null)
})
