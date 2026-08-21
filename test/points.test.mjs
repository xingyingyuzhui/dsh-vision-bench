import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  addSegment,
  applySegmentRead,
  compactSegments,
  expandPoints,
  pointName,
  removeSegment,
  simulateRaw,
} from '../bench-points.mjs'
import { addDevice } from '../bench-devices.mjs'
import { modbusPoll } from '../bench-actions.mjs'
import { loadWorkspace, openTask, saveWorkspace } from '../bench-store.mjs'

test('addSegment expands a holding range into consecutive points', () => {
  const added = addSegment([], { name: '温度', function: 3, address: 10, count: 4 })
  assert.equal(added.ok, true)
  const points = expandPoints(added.segments)
  assert.equal(points.length, 4)
  assert.equal(points[0].address, 10)
  assert.equal(points[3].address, 13)
  assert.equal(points[0].name, '温度[10]')
  assert.equal(pointName({ name: '水位', function: 3, address: 5, count: 1 }, 0), '水位')
})

test('addSegment rejects duplicates and overflow', () => {
  const first = addSegment([], { function: 3, address: 0, count: 10 })
  const dup = addSegment(first.segments, { function: 3, address: 0, count: 10 })
  assert.equal(dup.ok, false)
  const overflow = addSegment([], { function: 3, address: 65530, count: 20 })
  assert.equal(overflow.ok, false)
})

test('removeSegment drops values belonging to that range', () => {
  const added = addSegment([], { function: 4, address: 1, count: 2 })
  const values = applySegmentRead([], added.segment, {
    ok: true,
    result: { details: { raw: [11, 22] } },
  })
  assert.equal(values.length, 2)
  const next = removeSegment(added.segments, values, added.segment.id)
  assert.equal(next.segments.length, 0)
  assert.equal(next.values.length, 0)
})

test('saveWorkspace keeps segments across connection-only saves', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-seg-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const added = addSegment([], { name: 'HR', function: 3, address: 0, count: 8 })
    const saved = saveWorkspace(home, cwd, {
      modbus: { mode: 'tcp', host: '127.0.0.1', segments: added.segments },
    })
    assert.equal(saved.ok, true)
    assert.equal(saved.workspace.modbus.segments.length, 1)
    assert.equal(saved.workspace.modbus.segments[0].count, 8)
    const again = saveWorkspace(home, cwd, { modbus: { slave: 5 } })
    assert.equal(again.workspace.modbus.segments[0].count, 8)
    assert.equal(again.workspace.modbus.slave, 5)
    assert.equal(loadWorkspace(home, cwd).modbus.host, '127.0.0.1')
    assert.equal(compactSegments(again.workspace.modbus.segments)[0].count, 8)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('simulateRaw yields moving register values without a device', () => {
  const segment = { function: 3, address: 4, count: 3 }
  const a = simulateRaw(segment, 1_000_000)
  const b = simulateRaw(segment, 2_000_000)
  assert.equal(a.length, 3)
  assert.equal(a[0], (4 * 10 + 1000) & 0xffff)
  assert.notEqual(a[0], b[0])
  const coil = simulateRaw({ function: 1, address: 0, count: 2 }, 0)
  assert.equal(coil[0], true)
  assert.equal(coil[1], false)
})

test('modbusPoll sim path fills values without python', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-sim-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const added = addSegment([], { name: '模拟', function: 3, address: 0, count: 4 })
    saveWorkspace(home, cwd, { modbus: { sim: true, polling: { enabled: true }, segments: added.segments } })
    const polled = await modbusPoll(home, cwd)
    assert.equal(polled.ok, true)
    assert.equal(polled.skipped, false)
    assert.equal(polled.values.length, 4)
    assert.equal(polled.values[0].ok, true)
    assert.equal(typeof polled.values[0].value, 'number')
    assert.equal(loadWorkspace(home, cwd).tasks.length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusPoll does not open a task and skips while a read is running', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-poll-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const empty = await modbusPoll(home, cwd)
    assert.equal(empty.ok, false)
    assert.match(empty.error, /寄存器段/)
    const added = addSegment([], { function: 3, address: 0, count: 2 })
    saveWorkspace(home, cwd, { modbus: { mode: 'tcp', host: '127.0.0.1', segments: added.segments } })
    openTask(home, cwd, { type: 'read', source: 'user', summary: '读点表' })
    const skipped = await modbusPoll(home, cwd)
    assert.equal(skipped.ok, true)
    assert.equal(skipped.skipped, true)
    assert.equal(loadWorkspace(home, cwd).tasks.filter((item) => item.status === 'running').length, 1)
    saveWorkspace(home, cwd, { modbus: { polling: { enabled: true, intervalMs: 500 } } })
    assert.equal(loadWorkspace(home, cwd).modbus.polling.enabled, true)
    assert.equal(loadWorkspace(home, cwd).modbus.polling.intervalMs, 500)
    assert.equal(loadWorkspace(home, cwd).modbus.segments.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusPoll only reads devices with polling enabled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-watch-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const segs = addSegment([], { function: 3, address: 0, count: 2 }).segments
    let pack = addDevice({}, { role: 'master', name: 'A', sim: true, polling: { enabled: true }, segments: segs }).modbus
    pack = addDevice(pack, { role: 'master', name: 'B', sim: true, polling: { enabled: false }, segments: segs }).modbus
    saveWorkspace(home, cwd, { modbus: pack })
    const polled = await modbusPoll(home, cwd)
    assert.equal(polled.ok, true)
    const a = polled.devices.find((item) => item.name === 'A')
    const b = polled.devices.find((item) => item.name === 'B')
    assert.ok(a.values.length >= 2)
    assert.equal(b.values.length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
