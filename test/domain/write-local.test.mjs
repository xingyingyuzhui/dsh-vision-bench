import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusRead, modbusWrite } from '../../bench-actions.mjs'
import { journalView, loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

test('modbusWrite local path persists values, exits sim and records a task', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      conn: { sim: true },
      points: [
        { name: '保持', function: 3, address: 0 },
        { name: '保持1', function: 3, address: 1 },
        { name: '保持2', function: 3, address: 2 },
        { name: '保持3', function: 3, address: 3 },
        { name: '保持4', function: 3, address: 4 },
        { name: '保持5', function: 3, address: 5 },
        { name: '保持6', function: 3, address: 6 },
        { name: '保持7', function: 3, address: 7 },
        { name: '保持8', function: 3, address: 8 },
        { name: '保持9', function: 3, address: 9 },
      ],
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
  assert.equal(ws.modbus.conn.sim, false)
  const pt = ws.modbus.points.find((p) => (p.function === 3 || p.area === 'holdingRegister') && p.address === 2)
  const rec = ws.modbus.values.find((item) => item.key === pt.id || item.pointId === pt.id)
  assert.ok(pt && rec, 'point and value should exist for HR2')
  assert.equal(rec.value, 1234)
  const journal = journalView(ws)
  assert.ok(journal.tasks.some((item) => item.type === 'write' && item.status === 'ok'))
  assert.ok(journal.timeline.some((item) => item.kind === 'write-start'))
  assert.ok(journal.timeline.some((item) => item.kind === 'write-end'))
})

test('modbusWrite rejects addresses outside segments without opening a task', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-out-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      conn: { sim: true },
      points: [
        { name: '保持', function: 3, address: 0 },
        { name: '保持1', function: 3, address: 1 },
        { name: '保持2', function: 3, address: 2 },
        { name: '保持3', function: 3, address: 3 },
      ],
    },
  })
  const ran = await modbusWrite(home, cwd, {
    function: 3,
    address: 50,
    values: [1],
  })
  assert.equal(ran.ok, false)
  assert.match(ran.error, /不在点表/)
  const ws = loadWorkspace(home, cwd)
  assert.equal(journalView(ws).tasks.length, 0)
})

test('modbusWrite blocks a second write while one is running', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-lock-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      sim: true,
      segments: [{ name: '保持', function: 3, address: 0, count: 4 }],
    },
  })
  saveWorkspace(home, cwd, {
    tasks: [
      {
        id: 't-running',
        type: 'write',
        status: 'running',
        startedAt: Date.now(),
        summary: '旧写入',
      },
    ],
  })
  const ran = await modbusWrite(home, cwd, {
    function: 3,
    address: 0,
    values: [1],
  })
  assert.equal(ran.ok, false)
  assert.match(ran.error, /已有写入任务进行中/)
})

test('modbusWrite rejects read-only functions before touching tasks', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-ro-' })
  const { home, cwd } = bench
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
})

test('table read response carries framesLog from the runtime capture', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-frames-read-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      conn: { sim: true, mode: 'tcp', host: '10.0.0.8', tcpPort: 502 },
      points: [
        { name: 'HR0', function: 3, address: 0 },
        { name: 'HR1', function: 3, address: 1 },
      ],
    },
  })
  const ran = await modbusRead(home, cwd, { all: true, source: 'user' })
  assert.equal(ran.ok, true)
  assert.ok(Array.isArray(ran.framesLog))
  assert.ok(ran.framesLog.length >= 1)
  assert.ok(typeof ran.framesLog[0].deviceId === 'string' && ran.framesLog[0].deviceId.length > 0)
  assert.equal(ran.framesLog[0].transactionId, ran.framesLog[0].frameId)
  assert.match(ran.framesLog[0].label, /读/)
})
