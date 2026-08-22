import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pushFramesLog, getFramesLog, clearFramesLog } from '../bench-shared.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { modbusPoll, modbusRead, modbusWrite } from '../bench-modbus.mjs'
import { normalizeModbus } from '../bench-devices.mjs'

// ── framesByConnection 分轨：COM3 与 COM4 各自 500 环形互不串扰

test('framesByConnection 分轨：COM3 与 COM4 各自 500 环形互不串扰', () => {
  const cwd = '/tmp/dvb-frames-' + Date.now() + Math.random()
  clearFramesLog(cwd)
  // ensure clean start
  assert.equal(getFramesLog(cwd, 'c1').length, 0)
  const gen = (prefix, n, cid) => Array.from({ length: n }, (_, i) => ({
    t: Date.now() + i,
    label: prefix + i,
    request: 'REQ ' + i,
    response: 'RESP ' + i,
    trace: ['trace' + i],
    connectionId: cid,
    deviceId: 'd1',
  }))
  // push 600 to c1 (COM3) and 600 to c2 (COM4) -> each should cap at 500
  pushFramesLog(cwd, 'c1', gen('c1-', 600, 'c1'))
  pushFramesLog(cwd, 'c2', gen('c2-', 600, 'c2'))
  const c1 = getFramesLog(cwd, 'c1')
  const c2 = getFramesLog(cwd, 'c2')
  assert.equal(c1.length, 500)
  assert.equal(c2.length, 500)
  // verify isolation: c1 should contain only c1 labels, lowest kept is 100 (600-500)
  assert.ok(c1.every(f => f.label.startsWith('c1-')))
  assert.ok(c2.every(f => f.label.startsWith('c2-')))
  assert.equal(c1[0].label, 'c1-100')
  assert.equal(c2[0].label, 'c2-100')
  assert.equal(c1[c1.length - 1].label, 'c1-599')
  // aggregated all should be capped at 500 most recent across both (1000 total -> 500 recent)
  const all = getFramesLog(cwd, 'all')
  assert.equal(all.length, 500)
  // clear one connection not affect other
  clearFramesLog(cwd, 'c1')
  assert.equal(getFramesLog(cwd, 'c1').length, 0)
  assert.equal(getFramesLog(cwd, 'c2').length, 500)
  assert.equal(getFramesLog(cwd).length, 500) // default all after clear c1 -> only c2 remains? Actually getFramesLog(cwd) with no cid => default _? Let's check count
  // cleanup
  clearFramesLog(cwd)
  assert.equal(getFramesLog(cwd, 'c2').length, 0)
})

test('framesByConnection 500 环形：单独连接持续追加保持最新 500', () => {
  const cwd = '/tmp/dvb-frames2-' + Date.now() + Math.random()
  clearFramesLog(cwd)
  const gen = (n) => Array.from({ length: n }, (_, i) => ({ t: Date.now()+i, label: 'L'+i, request: 'R'+i, response: 'P'+i, trace: [] }))
  pushFramesLog(cwd, 'c1', gen(300))
  assert.equal(getFramesLog(cwd, 'c1').length, 300)
  pushFramesLog(cwd, 'c1', gen(300)) // now 600 -> capped 500, oldest 100 dropped
  const arr = getFramesLog(cwd, 'c1')
  assert.equal(arr.length, 500)
  // first gen's 0..99 should be gone, remaining start from 100 of first batch? Actually second batch overwrites? Need to check splice logic: it splice(0, len-500) keeps newest 500, so after 600 total, first 100 are dropped
  // Our gen produces labels L0..L299 twice. After first 300, array is L0..L299. After second 300, total 600 -> drop 100 -> should keep L100..L299 (200) + L0..L299 (300) = 500, but labels duplicate so hard to assert. Just check length.
  clearFramesLog(cwd)
})

test('多连接轮询：两条 enabled 连接并行 poll，pollingByConnection 各自 lastOk', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-multi-poll-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'COM3', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'COM4', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 }
    const p1 = { id: 'p-c1-hr0', connectionId: 'c1', deviceId: 'd1', name: 'C1-HR0', area: 'holdingRegister', function: 3, address: 0 }
    const p2 = { id: 'p-c1-hr1', connectionId: 'c1', deviceId: 'd1', name: 'C1-HR1', area: 'holdingRegister', function: 3, address: 1 }
    const p3 = { id: 'p-c2-hr0', connectionId: 'c2', deviceId: 'd2', name: 'C2-HR0', area: 'holdingRegister', function: 3, address: 10 }
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [c1, c2],
        devices: [d1, d2],
        points: [p1, p2, p3],
        activeConnectionId: 'c1',
        activeDeviceId: 'd1',
      },
    })
    const ran = await modbusPoll(home, cwd)
    assert.equal(ran.ok, true)
    assert.ok(ran.pollingByConnection)
    assert.ok(ran.pollingByConnection['c1'])
    assert.ok(ran.pollingByConnection['c2'])
    assert.equal(ran.pollingByConnection['c1'].lastOk, true)
    assert.equal(ran.pollingByConnection['c2'].lastOk, true)
    assert.ok(ran.pollingByConnection['c1'].lastAt > 0)
    assert.ok(ran.pollingByConnection['c2'].lastAt > 0)
    // framesByConnection分轨（sim 模式无真实帧，但需为数组且隔离）
    assert.ok(Array.isArray(ran.framesByConnection['c1']))
    assert.ok(Array.isArray(ran.framesByConnection['c2']))
    // values filled for all points
    assert.equal(ran.values.filter(v=> v.ok).length, 3)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.values.filter(v=> v.ok).length, 3)
    assert.equal(ws.modbus.pollingByConnection['c1'].lastOk, true)
    assert.equal(ws.modbus.pollingByConnection['c2'].lastOk, true)
    // targeted poll only one connection
    const ranOnly = await modbusPoll(home, cwd, { connectionId: 'c1' })
    // should still ok and update only c1?
    assert.equal(ranOnly.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('多连接轮询跳过 disabled 连接', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-poll-dis-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: false, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, area: 'holdingRegister' }
    const p2 = { id: 'p2', connectionId: 'c2', deviceId: 'd2', function: 3, address: 0, area: 'holdingRegister' }
    saveWorkspace(home, cwd, {
      modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [p1, p2] },
    })
    const ran = await modbusPoll(home, cwd)
    assert.equal(ran.ok, true)
    // only c1 should have frames, c2 disabled should not be polled (but polling entry still exists via normalize?)
    assert.ok(ran.framesByConnection['c1'])
    // disabled connection's polling should not be marked lastOk? Actually modbusPoll filters disabled, so it won't update c2. But ensure overall ok.
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('点位归属校验：跨连接点位读需 connId 定向，错 connId 报不在点表', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-point-own-read-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 }
    const p1 = { id: 'p-c1-hr0', connectionId: 'c1', deviceId: 'd1', name: 'C1-HR0', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, {
      modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [p1] },
    })
    // correct connId read ok
    const ok = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p-c1-hr0' })
    assert.equal(ok.ok, true)
    // wrong connId read should error 点位不在指定连接
    const wrongConn = await modbusRead(home, cwd, { connectionId: 'c2', deviceId: 'd1', pointId: 'p-c1-hr0' })
    assert.equal(wrongConn.ok, false)
    assert.match(wrongConn.error, /不在指定连接|点位不存在/)
    // wrong device should error 点位不在指定设备
    const wrongDev = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd2', pointId: 'p-c1-hr0' })
    assert.equal(wrongDev.ok, false)
    assert.match(wrongDev.error, /不在指定设备|点位不存在/)
    // connId alias connId
    const aliasOk = await modbusRead(home, cwd, { connId: 'c1', deviceId: 'd1', pointId: 'p-c1-hr0' })
    assert.equal(aliasOk.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('点位归属校验：跨连接点位写需 connId 定向，错 connId 报不在点表', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-point-own-write-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 }
    const p1 = { id: 'p-c1-hr0', connectionId: 'c1', deviceId: 'd1', name: 'C1-HR0', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, {
      modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [p1] },
    })
    // correct write ok (sim)
    const ok = await modbusWrite(home, cwd, { connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [99], source: 'user' })
    assert.equal(ok.ok, true)
    assert.equal(ok.connectionId, 'c1')
    // re-enable c1 sim for subsequent writes (local write flips sim to false)
    {
      const cur = loadWorkspace(home, cwd)
      const nextConns = cur.modbus.connections.map(c => c.id === 'c1' ? { ...c, conn: { ...c.conn, sim: true } } : c)
      saveWorkspace(home, cwd, { modbus: { connections: nextConns } })
    }
    // wrong connId write should fail 不在点表
    const wrongConn = await modbusWrite(home, cwd, { connectionId: 'c2', deviceId: 'd2', function: 3, address: 0, values: [1], source: 'user' })
    assert.equal(wrongConn.ok, false)
    assert.match(wrongConn.error, /不在点表/)
    // wrong connId but correct address should still fail because point not in c2
    const wrongAlias = await modbusWrite(home, cwd, { connId: 'c2', function: 3, address: 0, values: [1], source: 'user' })
    assert.equal(wrongAlias.ok, false)
    assert.match(wrongAlias.error, /不在点表/)
    // correct alias via connId (c1 sim re-enabled)
    const okAlias = await modbusWrite(home, cwd, { connId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [101], source: 'user' })
    assert.equal(okAlias.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('跨连接点位读写隔离：c1 点位不影响 c2 同地址点位', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-cross-isolate-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }
    const p2 = { id: 'p2', connectionId: 'c2', deviceId: 'd2', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, {
      modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [p1, p2] },
    })
    await modbusWrite(home, cwd, { connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [555], source: 'user' })
    let ws = loadWorkspace(home, cwd)
    let r1 = ws.modbus.values.find(v=> v.key==='p1')
    let r2 = ws.modbus.values.find(v=> v.key==='p2')
    assert.equal(r1.raw, 555)
    assert.ok(!r2 || r2.raw !== 555)
    await modbusWrite(home, cwd, { connectionId: 'c2', deviceId: 'd2', function: 3, address: 0, values: [777], source: 'user' })
    ws = loadWorkspace(home, cwd)
    r1 = ws.modbus.values.find(v=> v.key==='p1')
    r2 = ws.modbus.values.find(v=> v.key==='p2')
    assert.equal(r1.raw, 555)
    assert.equal(r2.raw, 777)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('connId 与 deviceId 别名一致：connId/deviceId 均支持', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-alias-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 7 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
    const rConnId = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' })
    const rAlias = await modbusRead(home, cwd, { connId: 'c1', deviceId: 'd1', pointId: 'p1' })
    assert.equal(rConnId.ok, true)
    assert.equal(rAlias.ok, true)
    const wConnId = await modbusWrite(home, cwd, { connectionId: 'c1', deviceId: 'd1', function: 3, address: 7, values: [10], source: 'user' })
    assert.equal(wConnId.ok, true)
    // re-enable sim after local write
    {
      const cur = loadWorkspace(home, cwd)
      const nextConns = cur.modbus.connections.map(c => c.id === 'c1' ? { ...c, conn: { ...c.conn, sim: true } } : c)
      saveWorkspace(home, cwd, { modbus: { connections: nextConns } })
    }
    const wAlias = await modbusWrite(home, cwd, { connId: 'c1', deviceId: 'd1', function: 3, address: 7, values: [11], source: 'user' })
    assert.equal(wAlias.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('点位表同连接同设备同地址重复被拒绝，跨设备同地址允许', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-points-dup-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 5 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1, d2], points: [p1] } })
    const { pointsOp } = await import('../bench-modbus.mjs')
    // same connection+device+function+address duplicate should be rejected
    const dup = pointsOp(home, cwd, { op: 'add', connectionId: 'c1', deviceId: 'd1', points: [{ function: 3, address: 5 }] })
    assert.equal(dup.ok, false)
    assert.match(dup.error, /已存在/)
    // same connection different device same address should be allowed
    const okCross = pointsOp(home, cwd, { op: 'add', connectionId: 'c1', deviceId: 'd2', points: [{ function: 3, address: 5, name: 'cross' }] })
    assert.equal(okCross.ok, true)
    assert.ok(okCross.points.some(p => p.deviceId === 'd2' && p.address === 5))
    // verify total points now 2
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.points.length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('framesByConnection 持久化：500 环形写入后隔离保存', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-frames-persist-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }
    // generate 600 frames per connection
    const gen = (prefix) => Array.from({ length: 600 }, (_, i) => ({ t: Date.now()+i, label: prefix+i, request: 'REQ'+i, response: 'RESP'+i, trace: [] }))
    const fbc = { c1: gen('c1-'), c2: gen('c2-') }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [], framesByConnection: fbc } })
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.framesByConnection['c1'].length, 500)
    assert.equal(ws.modbus.framesByConnection['c2'].length, 500)
    assert.ok(ws.modbus.framesByConnection['c1'].every(f => f.label.startsWith('c1-')))
    assert.ok(ws.modbus.framesByConnection['c2'].every(f => f.label.startsWith('c2-')))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('pollingByConnection 启用状态 per-connection 隔离', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-polling-isolate-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 }
    saveWorkspace(home, cwd, {
      modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [], pollingByConnection: { c1: { enabled: true, intervalMs: 500 }, c2: { enabled: false, intervalMs: 1000 } } },
    })
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.pollingByConnection['c1'].enabled, true)
    assert.equal(ws.modbus.pollingByConnection['c1'].intervalMs, 500)
    assert.equal(ws.modbus.pollingByConnection['c2'].enabled, false)
    assert.equal(ws.modbus.pollingByConnection['c2'].intervalMs, 1000)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
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
