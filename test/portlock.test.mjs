import assert from 'node:assert/strict'
import { chmod, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { isPortBusy, portKey, withPortLock } from '../bench-portlock.mjs'
import { closeSerialMonitor, findMonitoredPort, openSerialMonitor } from '../bench-serial-monitor.mjs'
import { normalizeTask } from '../bench-journal.mjs'

test('portKey normalizes device prefixes and case', () => {
  assert.equal(portKey('\\\\.\\COM3'), 'COM3')
  assert.equal(portKey('com3'), 'COM3')
  assert.equal(portKey(' COM10 '), 'COM10')
  assert.equal(portKey('/dev/ttyUSB0'), '/DEV/TTYUSB0')
  assert.equal(portKey(''), '')
})

test('withPortLock serializes concurrent transactions on one port', async () => {
  const order = []
  const job = (name, ms) => () => new Promise((resolve) => {
    order.push(name + '-start')
    setTimeout(() => {
      order.push(name + '-end')
      resolve(name)
    }, ms)
  })
  const [a, b] = await Promise.all([
    withPortLock('COM4', job('a', 40)),
    withPortLock('\\\\.\\com4', job('b', 5)),
  ])
  assert.equal(a, 'a')
  assert.equal(b, 'b')
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})

test('isPortBusy reflects in-flight transactions only', async () => {
  let release
  const gate = new Promise((resolve) => { release = resolve })
  const running = withPortLock('COM5', () => gate)
  await new Promise((resolve) => setTimeout(resolve, 20))
  assert.equal(isPortBusy('com5'), true)
  assert.equal(isPortBusy('COM6'), false)
  release()
  await running
  assert.equal(isPortBusy('COM5'), false)
})

test('openSerialMonitor refuses while the bus is busy and findMonitoredPort matches', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-portlock-'))
  const fake = join(home, 'fake_python.py')
  const { writeFile } = await import('node:fs/promises')
  await writeFile(fake, [
    'import json, sys, time',
    "print(json.dumps({'t': int(time.time()*1000), 'line': 'x'}), flush=True)",
    'time.sleep(5)',
  ].join('\n'))
  if (process.platform !== 'win32') await chmod(fake, 0o755)
  const runner = join(home, 'fake_python.sh')
  await writeFile(runner, '#!/bin/sh\nexec "' + process.execPath + '" "' + fake + '" "$@"\n')
  if (process.platform !== 'win32') await chmod(runner, 0o755)
  try {
    let release
    const gate = new Promise((resolve) => { release = resolve })
    const running = withPortLock('COM7', () => gate)
    await new Promise((resolve) => setTimeout(resolve, 20))
    const busy = openSerialMonitor(runner, home, { port: '\\\\.\\COM7' })
    assert.equal(busy.ok, false)
    assert.match(busy.error, /串口被占用/)
    release()
    await running

    const opened = openSerialMonitor(runner, home, { port: 'COM7' })
    assert.equal(opened.ok, true)
    const found = findMonitoredPort('\\\\.\\com7')
    assert.ok(found, 'monitor not found by normalized port')
    assert.equal(found.cwd, home)
    closeSerialMonitor(home)
    assert.equal(findMonitoredPort('COM7'), null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('normalizeTask caps frame payloads', () => {
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
