import assert from 'node:assert/strict'
import test from 'node:test'
import { normalizeModbus } from '../../bench-devices.mjs'
import { modbusRead, modbusWrite, pointsOp } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, dualConnTopology, hrPoint, reenableSim, rtuSim } from './multi-conn-fixtures.mjs'

test('点位归属校验：跨连接点位读需 connId 定向，错 connId 报不在点表', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-point-own-read-' })
  const { home, cwd } = bench
  const p1 = hrPoint('p-c1-hr0', 'c1', 'd1', 0, { name: 'C1-HR0' })
  bench.save({
    modbus: dualConnTopology({
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
      points: [p1],
    }),
  })
  const ok = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p-c1-hr0' })
  assert.equal(ok.ok, true)
  const wrongConn = await modbusRead(home, cwd, { connectionId: 'c2', deviceId: 'd1', pointId: 'p-c1-hr0' })
  assert.equal(wrongConn.ok, false)
  assert.match(wrongConn.error, /不在指定连接|点位不存在/)
  const wrongDev = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd2', pointId: 'p-c1-hr0' })
  assert.equal(wrongDev.ok, false)
  assert.match(wrongDev.error, /不在指定设备|点位不存在/)
  const aliasOk = await modbusRead(home, cwd, { connId: 'c1', deviceId: 'd1', pointId: 'p-c1-hr0' })
  assert.equal(aliasOk.ok, true)
})

test('点位归属校验：跨连接点位写需 connId 定向，错 connId 报不在点表', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-point-own-write-' })
  const { home, cwd } = bench
  const p1 = hrPoint('p-c1-hr0', 'c1', 'd1', 0, { name: 'C1-HR0' })
  bench.save({
    modbus: dualConnTopology({
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
      points: [p1],
    }),
  })
  const ok = await modbusWrite(home, cwd, {
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: 0,
    values: [99],
    source: 'user',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.connectionId, 'c1')
  reenableSim(home, cwd, 'c1')
  const wrongConn = await modbusWrite(home, cwd, {
    connectionId: 'c2',
    deviceId: 'd2',
    function: 3,
    address: 0,
    values: [1],
    source: 'user',
  })
  assert.equal(wrongConn.ok, false)
  assert.match(wrongConn.error, /不在点表/)
  const wrongAlias = await modbusWrite(home, cwd, {
    connId: 'c2',
    function: 3,
    address: 0,
    values: [1],
    source: 'user',
  })
  assert.equal(wrongAlias.ok, false)
  assert.match(wrongAlias.error, /不在点表/)
  const okAlias = await modbusWrite(home, cwd, {
    connId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: 0,
    values: [101],
    source: 'user',
  })
  assert.equal(okAlias.ok, true)
})

test('跨连接点位读写隔离：c1 点位不影响 c2 同地址点位', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-cross-isolate-' })
  const { home, cwd } = bench
  bench.save({
    modbus: dualConnTopology({
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 1, 'D2')],
      points: [hrPoint('p1', 'c1', 'd1', 0), hrPoint('p2', 'c2', 'd2', 0)],
    }),
  })
  await modbusWrite(home, cwd, {
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: 0,
    values: [555],
    source: 'user',
  })
  let ws = loadWorkspace(home, cwd)
  let r1 = ws.modbus.values.find((v) => v.key === 'p1')
  let r2 = ws.modbus.values.find((v) => v.key === 'p2')
  assert.equal(r1.raw, 555)
  assert.ok(!r2 || r2.raw !== 555)
  await modbusWrite(home, cwd, {
    connectionId: 'c2',
    deviceId: 'd2',
    function: 3,
    address: 0,
    values: [777],
    source: 'user',
  })
  ws = loadWorkspace(home, cwd)
  r1 = ws.modbus.values.find((v) => v.key === 'p1')
  r2 = ws.modbus.values.find((v) => v.key === 'p2')
  assert.equal(r1.raw, 555)
  assert.equal(r2.raw, 777)
})

test('connId 与 deviceId 别名一致：connId/deviceId 均支持', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-alias-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  const d1 = device('d1', 'c1', 1, 'D1')
  const p1 = hrPoint('p1', 'c1', 'd1', 7)
  bench.save({ modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
  const rConnId = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' })
  const rAlias = await modbusRead(home, cwd, { connId: 'c1', deviceId: 'd1', pointId: 'p1' })
  assert.equal(rConnId.ok, true)
  assert.equal(rAlias.ok, true)
  const wConnId = await modbusWrite(home, cwd, {
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: 7,
    values: [10],
    source: 'user',
  })
  assert.equal(wConnId.ok, true)
  reenableSim(home, cwd, 'c1')
  const wAlias = await modbusWrite(home, cwd, {
    connId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: 7,
    values: [11],
    source: 'user',
  })
  assert.equal(wAlias.ok, true)
})

test('点位表同连接同设备同地址重复被拒绝，跨设备同地址允许', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-points-dup-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  bench.save({
    modbus: {
      version: 3,
      connections: [c1],
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c1', 2, 'D2')],
      points: [hrPoint('p1', 'c1', 'd1', 5)],
    },
  })
  const dup = await pointsOp(home, cwd, {
    op: 'add',
    connectionId: 'c1',
    deviceId: 'd1',
    points: [{ function: 3, address: 5 }],
  })
  assert.equal(dup.ok, false)
  assert.match(dup.error, /已存在/)
  const okCross = await pointsOp(home, cwd, {
    op: 'add',
    connectionId: 'c1',
    deviceId: 'd2',
    points: [{ function: 3, address: 5, name: 'cross' }],
  })
  assert.equal(okCross.ok, true)
  assert.ok(okCross.points.some((p) => p.deviceId === 'd2' && p.address === 5))
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.modbus.points.length, 2)
})

test('v2→v3 迁移旧 points 带 scale/offset/unit 保留', () => {
  const v2 = {
    version: 2,
    conn: { mode: 'rtu', port: 'COM7', slave: 9, sim: false },
    points: [{ id: 'p3_10', function: 3, address: 10, scale: 0.5, offset: 2, unit: 'kPa', alarmMin: 1, alarmMax: 99 }],
    values: [{ key: 'p3_10', raw: 20, ok: true, at: 123 }],
  }
  const m = normalizeModbus(v2)
  const pt = m.points[0]
  assert.equal(pt.scale, 0.5)
  assert.equal(pt.offset, 2)
  assert.equal(pt.unit, 'kPa')
  assert.equal(pt.alarmMin, 1)
  assert.equal(pt.alarmMax, 99)
  const val = m.values[0]
  assert.equal(val.raw, 20)
})
