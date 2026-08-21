import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  isWritableFunction,
  normalizeWriteValues,
  segmentCovering,
  writeTargetOf,
} from '../bench-points.mjs'
import { handlePdu, _internal } from '../bench-slave.mjs'
import { recipePair } from '../bench-devices.mjs'
import { modbusWrite, resolvePendingWrite } from '../bench-actions.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { journalView, loadWorkspace, saveWorkspace } from '../bench-store.mjs'

test('writeTargetOf marks coils and holding registers writable', () => {
  assert.equal(writeTargetOf(1).writable, true)
  assert.equal(writeTargetOf(1).single, 5)
  assert.equal(writeTargetOf(1).multi, 15)
  assert.equal(writeTargetOf(3).writable, true)
  assert.equal(writeTargetOf(3).single, 6)
  assert.equal(writeTargetOf(3).multi, 16)
  assert.equal(writeTargetOf(2).writable, false)
  assert.equal(writeTargetOf(4).writable, false)
  assert.equal(isWritableFunction(3), true)
  assert.equal(isWritableFunction(4), false)
})

test('normalizeWriteValues validates kinds, ranges and batch caps', () => {
  assert.deepEqual(normalizeWriteValues(3, [12], 10), {
    ok: true,
    kind: 'register',
    fc: 6,
    values: [12],
  })
  assert.deepEqual(normalizeWriteValues(3, [1, 2, 3], 10), {
    ok: true,
    kind: 'register',
    fc: 16,
    values: [1, 2, 3],
  })
  assert.deepEqual(normalizeWriteValues(1, [true], 10).fc, 5)
  assert.equal(normalizeWriteValues(1, [2], 10).ok, false)
  assert.equal(normalizeWriteValues(3, [-1], 10).ok, false)
  assert.equal(normalizeWriteValues(3, [70000], 10).ok, false)
  assert.equal(normalizeWriteValues(3, [1.5], 10).ok, false)
  assert.equal(normalizeWriteValues(2, [1], 10).ok, false)
  assert.equal(normalizeWriteValues(4, [1], 10).ok, false)
  const tooMany = new Array(124).fill(1)
  assert.equal(normalizeWriteValues(3, tooMany, 1968).ok, false)
})

test('segmentCovering finds the owning segment only inside its range', () => {
  const segments = [
    { id: 'a', function: 3, address: 0, count: 10 },
    { id: 'b', function: 1, address: 20, count: 4 },
  ]
  assert.equal(segmentCovering(segments, 3, 9).id, 'a')
  assert.equal(segmentCovering(segments, 3, 10), null)
  assert.equal(segmentCovering(segments, 1, 23).id, 'b')
  assert.equal(segmentCovering(segments, 3, 23), null)
})

test('slave handlePdu echoes single writes and reports them', () => {
  const device = {
    ...recipePair().devices[1],
    segments: [
      { id: 'hr', name: '保持', function: 3, address: 0, count: 10 },
      { id: 'coil', name: '线圈', function: 1, address: 0, count: 8 },
    ],
  }
  const seen = []
  const fc6 = Buffer.from([6, 0, 3, 0x12, 0x34])
  const resp = handlePdu(device, fc6, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.equal(resp[0], 6)
  assert.equal(resp.readUInt16BE(1), 3)
  assert.equal(resp.readUInt16BE(3), 0x1234)
  assert.deepEqual(seen, [{ fn: 3, address: 3, values: [0x1234] }])
  seen.length = 0
  const fc5 = Buffer.from([5, 0, 2, 0xff, 0])
  handlePdu(device, fc5, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.deepEqual(seen, [{ fn: 1, address: 2, values: [1] }])
})

test('slave handlePdu applies batch writes FC15/FC16', () => {
  const device = {
    ...recipePair().devices[1],
    segments: [
      { id: 'hr', name: '保持', function: 3, address: 0, count: 10 },
      { id: 'coil', name: '线圈', function: 1, address: 20, count: 8 },
    ],
  }
  const seen = []
  const regs = Buffer.alloc(6 + 4)
  regs[0] = 16
  regs.writeUInt16BE(4, 1)
  regs.writeUInt16BE(2, 3)
  regs[5] = 4
  regs.writeUInt16BE(100, 6)
  regs.writeUInt16BE(200, 8)
  const resp = handlePdu(device, regs, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.equal(resp[0], 16)
  assert.deepEqual(seen, [{ fn: 3, address: 4, values: [100, 200] }])
  seen.length = 0
  const coils = Buffer.alloc(6 + 1)
  coils[0] = 15
  coils.writeUInt16BE(20, 1)
  coils.writeUInt16BE(3, 3)
  coils[5] = 1
  coils[6] = 0b101
  handlePdu(device, coils, 1_000_000, (fn, address, values) => seen.push({ fn, address, values }))
  assert.deepEqual(seen, [{ fn: 1, address: 20, values: [1, 0, 1] }])
})

test('slave handlePdu rejects writes outside declared segments', () => {
  const device = recipePair().devices[1]
  const outside = Buffer.from([6, 0, 50, 0, 7])
  const resp = handlePdu(device, outside, 1_000_000, () => {
    throw new Error('should not persist')
  })
  assert.equal(resp[0], 6 | 0x80)
  assert.equal(resp[1], 2)
  const badCoil = Buffer.from([5, 0, 0, 0x12, 0x34])
  assert.equal(handlePdu(device, badCoil, 1_000_000)[1], 3)
})

test('modbusWrite local path persists values, exits sim and records a task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-write-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        sim: true,
        segments: [{ name: '保持', function: 3, address: 0, count: 10 }],
      },
    })
    const ran = await modbusWrite(home, cwd, {
      source: 'user',
      function: 3,
      address: 2,
      values: [1234],
    })
    assert.equal(ran.ok, true)
    assert.equal(ran.simulated, true)
    assert.deepEqual(ran.target, [1234])
    assert.deepEqual(ran.readback, [1234])
    const ws = loadWorkspace(home, cwd)
    const device = ws.modbus.devices[0]
    assert.equal(device.sim, false)
    const rec = device.values.find((item) => item.address === 2 && item.function === 3)
    assert.equal(rec.value, 1234)
    const journal = journalView(ws)
    assert.ok(journal.tasks.some((item) => item.type === 'write' && item.status === 'ok'))
    assert.ok(journal.timeline.some((item) => item.kind === 'write-start'))
    assert.ok(journal.timeline.some((item) => item.kind === 'write-end'))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusWrite rejects addresses outside segments without opening a task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-write-out-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        sim: true,
        segments: [{ name: '保持', function: 3, address: 0, count: 4 }],
      },
    })
    const ran = await modbusWrite(home, cwd, {
      function: 3,
      address: 50,
      values: [1],
    })
    assert.equal(ran.ok, false)
    assert.match(ran.error, /不在点表段内/)
    const ws = loadWorkspace(home, cwd)
    assert.equal(journalView(ws).tasks.length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusWrite blocks a second write while one is running', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-write-lock-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        sim: true,
        segments: [{ name: '保持', function: 3, address: 0, count: 4 }],
      },
    })
    saveWorkspace(home, cwd, {
      tasks: [{
        id: 't-running',
        type: 'write',
        status: 'running',
        startedAt: Date.now(),
        summary: '旧写入',
      }],
    })
    const ran = await modbusWrite(home, cwd, {
      function: 3,
      address: 0,
      values: [1],
    })
    assert.equal(ran.ok, false)
    assert.match(ran.error, /已有写入任务进行中/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusWrite rejects read-only functions before touching tasks', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-write-ro-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        sim: true,
        segments: [{ name: '输入', function: 4, address: 0, count: 4 }],
      },
    })
    const ran = await modbusWrite(home, cwd, {
      function: 4,
      address: 0,
      values: [1],
    })
    assert.equal(ran.ok, false)
    assert.match(ran.error, /只读/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('runVisionBench write action requires user approval then executes', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-tool-write-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        sim: true,
        segments: [{ name: '保持', function: 3, address: 0, count: 10 }],
      },
    })
    const first = await runVisionBench(home, {
      action: 'write',
      function: 3,
      address: 5,
      values: [42, 43],
    }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(first.ok, false)
    assert.equal(first.needsConfirm, true)
    assert.ok(first.requestId)
    assert.deepEqual(first.request.values, [42, 43])
    const untouched = loadWorkspace(home, cwd).modbus.devices[0].values
    assert.equal((untouched || []).length, 0)

    const ran = await resolvePendingWrite(home, cwd, first.requestId, true)
    assert.equal(ran.ok, true)
    assert.deepEqual(ran.target, [42, 43])
    assert.deepEqual(ran.readback, [42, 43])
    const ws = loadWorkspace(home, cwd)
    const task = journalView(ws).tasks.find((item) => item.type === 'write')
    assert.equal(task.source, 'agent')
    assert.equal(task.sessionId, 's1')
    const rec = ws.modbus.devices[0].values.filter((item) => item.function === 3 && item.address >= 5)
    assert.equal(rec.length, 2)

    const gone = await resolvePendingWrite(home, cwd, first.requestId, false)
    assert.equal(gone.ok, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('rejecting a pending agent write leaves the device untouched', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-tool-reject-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        sim: true,
        segments: [{ name: '保持', function: 3, address: 0, count: 10 }],
      },
    })
    const first = await runVisionBench(home, {
      action: 'write',
      function: 3,
      address: 1,
      values: [7],
    }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(first.needsConfirm, true)
    const ran = await resolvePendingWrite(home, cwd, first.requestId, false)
    assert.equal(ran.ok, true)
    assert.equal(ran.rejected, true)
    const ws = loadWorkspace(home, cwd)
    assert.equal(((ws.modbus.devices[0].values) || []).length, 0)
    assert.ok(ws.timeline.some((item) => item.kind === 'write-reject' && item.ok === false))
    assert.equal(journalView(ws).tasks.filter((item) => item.type === 'write').length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
