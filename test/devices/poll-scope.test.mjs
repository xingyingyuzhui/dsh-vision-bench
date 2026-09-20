import assert from 'node:assert/strict'
import test from 'node:test'
import { commitWriteResult } from '../../bench-modbus-commit.mjs'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, dualConnTopology, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

test('poll c2 with same FC03/addr0 as c1 only updates c2 point', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-poll-scope-conn-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  const c2 = rtuSim('c2', 'COM4', { name: 'C2' })
  bench.save({
    modbus: {
      ...dualConnTopology({
        connections: [c1, c2],
        devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
        points: [
          hrPoint('p1', 'c1', 'd1', 0, { name: 'C1-HR0', monitorEnabled: true }),
          hrPoint('p2', 'c2', 'd2', 0, { name: 'C2-HR0', monitorEnabled: true }),
        ],
      }),
      values: [{ key: 'p1', pointId: 'p1', raw: 111, value: 111, ok: true, at: 1 }],
      trend: { p1: [[1, 111]] },
      pollingByConnection: {
        c1: { enabled: false, intervalMs: 1000 },
        c2: { enabled: true, intervalMs: 1000 },
      },
    },
  })

  const ran = await modbusPoll(home, cwd, { connectionId: 'c2' })
  assert.equal(ran.ok, true, ran.error)
  const ws = loadWorkspace(home, cwd)
  const v1 = ws.modbus.values.find((v) => (v.pointId || v.key) === 'p1')
  const v2 = ws.modbus.values.find((v) => (v.pointId || v.key) === 'p2')
  assert.equal(v1?.raw, 111, 'c1/p1 must stay untouched when polling c2')
  assert.equal(v2?.ok, true, 'c2/p2 must be updated')
  assert.ok(Array.isArray(ws.modbus.trend?.p2) && ws.modbus.trend.p2.length >= 1, 'c2 trend sample')
  assert.equal(ws.modbus.trend?.p1?.length, 1, 'c1 must not gain a poll trend sample')
})

test('same connection different devices with same address do not cross-wire', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-poll-scope-dev-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  bench.save({
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [c1],
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c1', 2, 'D2')],
      points: [
        hrPoint('p-d1', 'c1', 'd1', 0, { name: 'D1-HR0', monitorEnabled: true }),
        hrPoint('p-d2', 'c1', 'd2', 0, { name: 'D2-HR0', monitorEnabled: true }),
      ],
      values: [],
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
    },
  })

  const ran = await modbusPoll(home, cwd, { connectionId: 'c1' })
  assert.equal(ran.ok, true, ran.error)
  const ws = loadWorkspace(home, cwd)
  const a = ws.modbus.values.find((v) => (v.pointId || v.key) === 'p-d1')
  const b = ws.modbus.values.find((v) => (v.pointId || v.key) === 'p-d2')
  assert.equal(a?.ok, true)
  assert.equal(b?.ok, true)
  assert.notEqual(a?.raw, undefined)
  assert.notEqual(b?.raw, undefined)
  // Sim fill is address+time based per point config; both ok is enough to prove both scopes ran.
  assert.ok(ws.modbus.trend?.['p-d1']?.length >= 1)
  assert.ok(ws.modbus.trend?.['p-d2']?.length >= 1)
})

test('poll commit of touched points does not overwrite concurrent write results', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-poll-scope-race-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  const c2 = rtuSim('c2', 'COM4', { name: 'C2' })
  bench.save({
    modbus: {
      ...dualConnTopology({
        connections: [c1, c2],
        devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
        points: [
          hrPoint('p1', 'c1', 'd1', 0, { monitorEnabled: true }),
          hrPoint('p2', 'c2', 'd2', 0, { monitorEnabled: true }),
        ],
      }),
      values: [
        { key: 'p1', pointId: 'p1', raw: 1, value: 1, ok: true, at: 1 },
        { key: 'p2', pointId: 'p2', raw: 2, value: 2, ok: true, at: 1 },
      ],
      pollingByConnection: {
        c1: { enabled: false, intervalMs: 1000 },
        c2: { enabled: true, intervalMs: 1000 },
      },
    },
  })

  const seeded = loadWorkspace(home, cwd)
  // Simulate a manual write landing while a long poll of c2 is conceptually in flight:
  // write updates p1 on disk, then poll(c2) commits only touched c2 points.
  const written = await commitWriteResult(home, cwd, {
    baseConfigVersion: seeded.modbus.configVersion,
    connectionId: 'c1',
    deviceId: 'd1',
    pointValues: [{ key: 'p1', pointId: 'p1', raw: 99, value: 99, ok: true, at: Date.now() }],
  })
  assert.equal(written.workspace.modbus.values.find((v) => (v.pointId || v.key) === 'p1')?.raw, 99)
  const ran = await modbusPoll(home, cwd, { connectionId: 'c2' })
  assert.equal(ran.ok, true, ran.error)
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.modbus.values.find((v) => (v.pointId || v.key) === 'p1')?.raw, 99)
  assert.equal(ws.modbus.values.find((v) => (v.pointId || v.key) === 'p2')?.ok, true)
})
