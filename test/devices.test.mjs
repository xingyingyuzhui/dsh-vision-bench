import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeConn, normalizeModbus, connLabel, patchConn, validateConnections, validateDevices } from '../bench-devices.mjs'
import { modbusPoll, modbusWrite, modbusRead } from '../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { setPointValue, pointIdOf } from '../bench-points.mjs'

test('normalizeConn applies defaults and clamps', () => {
  const c = normalizeConn({ mode: 'tcp', baudrate: 0, bytesize: 9, parity: 'X', stopbits: 7, slave: 300 })
  assert.equal(c.mode, 'tcp')
  assert.equal(c.baudrate, 9600)
  assert.equal(c.bytesize, 8)
  assert.equal(c.parity, 'N')
  assert.equal(c.stopbits, 1)
  assert.equal(c.slave, 247)
  const rtu = normalizeConn({ port: ' COM3 ', parity: 'E', stopbits: 2, bytesize: 7 })
  assert.equal(rtu.mode, 'rtu')
  assert.equal(rtu.port, 'COM3')
  assert.equal(rtu.parity, 'E')
  assert.equal(rtu.stopbits, 2)
  assert.equal(rtu.bytesize, 7)
})

test('legacy devices+segments workspaces migrate into points', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-migrate-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        mode: 'rtu',
        port: 'COM5',
        baudrate: 19200,
        slave: 3,
        sim: true,
        segments: [
          { id: 'sA', name: '温度块', function: 3, address: 0, count: 2, scale: 0.1, offset: -40, unit: '℃' },
          { id: 'sB', name: '阀门', function: 1, address: 9, count: 1 },
        ],
        values: [{ key: 'sB:1@9', value: 1, raw: true, ok: true, at: 42 }],
      },
    })
    const ws = await import('../bench-store.mjs').then((m) => m.loadWorkspace(home, cwd))
    const mb = ws.modbus
    assert.equal(mb.version, 3)
    // legacy getters still work
    assert.equal(mb.conn.port, 'COM5')
    assert.equal(mb.conn.slave, 3)
    assert.equal(mb.conn.sim, true)
    // v3 structures
    assert.equal(mb.connections.length, 1)
    assert.equal(mb.connections[0].conn.port, 'COM5')
    assert.equal(mb.connections[0].role, 'client')
    assert.equal(mb.devices.length, 1)
    assert.equal(mb.devices[0].connectionId, 'c1')
    assert.equal(mb.devices[0].unitId, 3)
    assert.equal(mb.points.length, 3)
    // points carry connectionId/deviceId/area mapping, ids are stable nanoid-style and unique
    const ids = mb.points.map((p) => p.id)
    assert.equal(new Set(ids).size, 3)
    for (const id of ids) assert.ok(typeof id === 'string' && id.length >= 2)
    // verify area mapping and addresses
    const sorted = [...mb.points].sort((a,b)=> a.address - b.address)
    // addresses 0,1,9 - check areas
    const p0 = mb.points.find(p=> p.address===0)
    const p1 = mb.points.find(p=> p.address===1)
    const p9 = mb.points.find(p=> p.address===9)
    assert.equal(p0.area, 'holdingRegister')
    assert.equal(p1.area, 'holdingRegister')
    assert.equal(p9.area, 'coil')
    assert.equal(p0.connectionId, 'c1')
    assert.equal(p0.deviceId, 'd1')
    // batch segment drops its block name; single-point segment keeps it
    assert.equal(p9.name, '阀门')
    assert.equal(p0.scale, 0.1)
    // migrated values keep their payload under the new pointId key
    const valvePoint = mb.points.find(p=> p.area==='coil' && p.address===9)
    const valve = mb.values.find((v) => v.key === valvePoint.id || v.pointId === valvePoint.id)
    assert.ok(valve && valve.value === 1 && valve.at === 42)
    // qualified values carry redundant connection/device for filtering (may be via point)
    const qConn = valve.connectionId || valvePoint.connectionId
    const qDev = valve.deviceId || valvePoint.deviceId
    assert.equal(qConn, 'c1')
    assert.equal(qDev, 'd1')
    // frames migrated to c1
    assert.ok(mb.framesByConnection && mb.framesByConnection['c1'] !== undefined)
    assert.ok(mb.pollingByConnection && mb.pollingByConnection['c1'] !== undefined)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('patchConn merges without touching points or values', () => {
  const base = normalizeModbus({
    conn: { port: 'COM3', baudrate: 9600 },
    points: [{ function: 3, address: 1 }],
    values: [{ key: 'p3_1', raw: 5, value: 5, ok: true, at: 1 }],
  })
  const next = patchConn(base, { baudrate: 19200, host: 'x' })
  assert.equal(next.conn.baudrate, 19200)
  assert.equal(next.conn.host, 'x')
  assert.equal(next.conn.port, 'COM3')
  assert.equal(next.points.length, 1)
  assert.equal(next.values.length, 1)
})

test('connLabel renders both modes', () => {
  assert.match(connLabel(normalizeConn({ port: 'COM3', baudrate: 9600, slave: 2 })), /COM3 @ 9600/)
  assert.match(connLabel(normalizeConn({ mode: 'tcp', host: '10.0.0.8', tcpPort: 1502, slave: 4 })), /10\.0\.0\.8:1502/)
})

test('modbusPoll reports missing points cleanly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-poll-v2-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, { modbus: { conn: { sim: true } } })
    const ran = await modbusPoll(home, cwd)
    assert.equal(ran.ok, false)
    assert.match(ran.error, /无点位/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusPoll sim path batches contiguous points and fills values', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-poll-batch-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        conn: { sim: true },
        polling: { enabled: true },
        points: [
          { name: 'a', function: 3, address: 0 },
          { name: 'b', function: 3, address: 1 },
          { name: 'c', function: 3, address: 2 },
        ],
      },
    })
    const ran = await modbusPoll(home, cwd)
    assert.equal(ran.ok, true)
    assert.ok(Array.isArray(ran.framesLog))
    const ws = await import('../bench-store.mjs').then((m) => m.loadWorkspace(home, cwd))
    const filled = ws.modbus.values.filter((v) => v.ok).length
    assert.equal(filled, 3)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('RTU COM 全局唯一：两条 enabled 连接同 COM3 冲突被 validateConnections 阻止', async () => {
  const conns = [
    { id: 'c1', name: '连接A', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600 } },
    { id: 'c2', name: '连接B', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 19200 } },
  ]
  const errs = validateConnections(conns)
  assert.ok(errs.length >= 1)
  assert.match(errs[0], /COM.*占用/)
  // case-insensitive com3 vs COM3
  const connsCI = [
    { id: 'c1', name: 'A', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'com3' } },
    { id: 'c2', name: 'B', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
  ]
  assert.ok(validateConnections(connsCI).length >= 1)
  // disabled duplicate should not block
  const connsDis = [
    { id: 'c1', name: 'A', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
    { id: 'c2', name: 'B', role: 'client', enabled: false, conn: { mode: 'rtu', port: 'COM3' } },
  ]
  assert.equal(validateConnections(connsDis).length, 0)
  // via bench-store saveWorkspace 阻止
  const home = await mkdtemp(join(tmpdir(), 'dvb-com-unique-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const first = saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: '连接1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600 } }],
        devices: [{ id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 }],
        points: [],
      },
    })
    assert.equal(first.ok, true)
    const second = saveWorkspace(home, cwd, {
      modbus: {
        connections: [
          { id: 'c1', name: '连接1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
          { id: 'c2', name: '连接2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
        ],
      },
    })
    assert.equal(second.ok, false)
    assert.match(second.error, /COM/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('TCP listenHost:listenPort 唯一，TCP 客户端 host:port 允许复用', () => {
  const serverDup = [
    { id: 'c1', name: '服务端A', role: 'server', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
    { id: 'c2', name: '服务端B', role: 'server', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
  ]
  const errs = validateConnections(serverDup)
  assert.ok(errs.length >= 1)
  assert.match(errs[0], /监听地址/)
  // empty host treated as 0.0.0.0 should conflict with explicit 0.0.0.0
  const serverEmpty = [
    { id: 'c1', name: 'S1', role: 'server', enabled: true, conn: { mode: 'tcp', host: '', tcpPort: 502 } },
    { id: 'c2', name: 'S2', role: 'server', enabled: true, conn: { mode: 'tcp', host: '0.0.0.0', tcpPort: 502 } },
  ]
  assert.ok(validateConnections(serverEmpty).length >= 1)
  // disabled server duplicate allowed
  const serverDis = [
    { id: 'c1', name: 'S1', role: 'server', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
    { id: 'c2', name: 'S2', role: 'server', enabled: false, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
  ]
  assert.equal(validateConnections(serverDis).length, 0)
  // TCP client reuse allowed
  const clientDup = [
    { id: 'c1', name: '客户端A', role: 'client', enabled: true, conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 } },
    { id: 'c2', name: '客户端B', role: 'client', enabled: true, conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 } },
  ]
  assert.equal(validateConnections(clientDup).length, 0)
  // server vs client same host:port not conflict
  const mixed = [
    { id: 'c1', name: '服务端', role: 'server', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
    { id: 'c2', name: '客户端', role: 'client', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
  ]
  assert.equal(validateConnections(mixed).length, 0)
  // different port allowed even for server
  const serverDiff = [
    { id: 'c1', name: 'S1', role: 'server', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
    { id: 'c2', name: 'S2', role: 'server', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 503 } },
  ]
  assert.equal(validateConnections(serverDiff).length, 0)
})

test('同一连接内 Unit ID 唯一校验', async () => {
  const conns = [{ id: 'c1', name: '连接1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } }]
  const devDup = [
    { id: 'd1', connectionId: 'c1', name: '设备A', unitId: 1, enabled: true },
    { id: 'd2', connectionId: 'c1', name: '设备B', unitId: 1, enabled: true },
  ]
  const errs = validateDevices(devDup, conns)
  assert.ok(errs.length >= 1)
  assert.match(errs[0], /Unit ID.*重复/)
  const viaConn = validateConnections(conns, devDup)
  assert.ok(viaConn.length >= 1)
  assert.match(viaConn.join(''), /Unit ID/)
  // disabled duplicate allowed
  const devDis = [
    { id: 'd1', connectionId: 'c1', name: 'A', unitId: 1, enabled: true },
    { id: 'd2', connectionId: 'c1', name: 'B', unitId: 1, enabled: false },
  ]
  assert.equal(validateDevices(devDis, conns).length, 0)
  // same unitId across different connections allowed
  const conns2 = [
    { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
    { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4' } },
  ]
  const devCross = [
    { id: 'd1', connectionId: 'c1', name: 'A', unitId: 1 },
    { id: 'd2', connectionId: 'c2', name: 'B', unitId: 1 },
  ]
  assert.equal(validateDevices(devCross, conns2).length, 0)
  // different unitId within same connection allowed
  const devDiff = [
    { id: 'd1', connectionId: 'c1', name: 'A', unitId: 1 },
    { id: 'd2', connectionId: 'c1', name: 'B', unitId: 2 },
  ]
  assert.equal(validateDevices(devDiff, conns).length, 0)
  // via saveWorkspace 阻止
  const home = await mkdtemp(join(tmpdir(), 'dvb-unit-unique-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3' } }],
        devices: [{ id: 'd1', connectionId: 'c1', name: 'A', unitId: 1 }],
        points: [],
      },
    })
    const dup = saveWorkspace(home, cwd, {
      modbus: {
        devices: [
          { id: 'd1', connectionId: 'c1', name: 'A', unitId: 1 },
          { id: 'd2', connectionId: 'c1', name: 'B', unitId: 1 },
        ],
      },
    })
    assert.equal(dup.ok, false)
    assert.match(dup.error, /Unit ID/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('同一 RTU 连接下两 Unit ID 同地址点位不串扰（p3_0 在 unit1 与 unit2 值隔离）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-isolate-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'COM3', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'Unit1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c1', name: 'Unit2', unitId: 2 }
    const p1 = { id: 'p-d1-hr0', connectionId: 'c1', deviceId: 'd1', name: 'U1-HR0', area: 'holdingRegister', function: 3, address: 0 }
    const p2 = { id: 'p-d2-hr0', connectionId: 'c1', deviceId: 'd2', name: 'U2-HR0', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [c1],
        devices: [d1, d2],
        points: [p1, p2],
        values: [],
        activeConnectionId: 'c1',
        activeDeviceId: 'd1',
      },
    })
    // write to d1 HR0 = 111, d2 HR0 should stay isolated
    const w1 = await modbusWrite(home, cwd, { connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [111], source: 'user' })
    assert.equal(w1.ok, true)
    assert.deepEqual(w1.target, [111])
    let ws = loadWorkspace(home, cwd)
    let rec1 = ws.modbus.values.find(v => v.key === 'p-d1-hr0' || v.pointId === 'p-d1-hr0')
    let rec2 = ws.modbus.values.find(v => v.key === 'p-d2-hr0' || v.pointId === 'p-d2-hr0')
    assert.ok(rec1 && rec1.raw === 111)
    assert.ok(!rec2 || rec2.raw !== 111)
    // sim flips to false after local write; re-enable for second write on same connection
    {
      const cur = loadWorkspace(home, cwd)
      const nextConns = cur.modbus.connections.map(c => c.id === 'c1' ? { ...c, conn: { ...c.conn, sim: true } } : c)
      saveWorkspace(home, cwd, { modbus: { connections: nextConns } })
    }
    // write to d2 HR0 = 222, d1 should stay 111
    const w2 = await modbusWrite(home, cwd, { connectionId: 'c1', deviceId: 'd2', function: 3, address: 0, values: [222], source: 'user' })
    assert.equal(w2.ok, true)
    ws = loadWorkspace(home, cwd)
    rec1 = ws.modbus.values.find(v => v.key === 'p-d1-hr0' || v.pointId === 'p-d1-hr0')
    rec2 = ws.modbus.values.find(v => v.key === 'p-d2-hr0' || v.pointId === 'p-d2-hr0')
    assert.equal(rec1.raw, 111)
    assert.equal(rec2.raw, 222)
    // re-enable sim before reads
    {
      const cur = loadWorkspace(home, cwd)
      const nextConns = cur.modbus.connections.map(c => c.id === 'c1' ? { ...c, conn: { ...c.conn, sim: true } } : c)
      saveWorkspace(home, cwd, { modbus: { connections: nextConns } })
    }
    // verify point lookup isolation via modbusRead pointId
    const r1 = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p-d1-hr0' })
    assert.equal(r1.ok, true)
    const r2 = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd2', pointId: 'p-d2-hr0' })
    assert.equal(r2.ok, true)
    // wrong device should not find
    const rWrong = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p-d2-hr0' })
    // pointId lookup checks device? should fail when device mismatch
    assert.equal(rWrong.ok, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('v2→v3 迁移：旧 conn+points 正确迁为 c1/d1', async () => {
  // direct normalizeModbus v2 shape
  const v2 = {
    version: 2,
    conn: { mode: 'rtu', port: 'COM9', baudrate: 115200, slave: 5, sim: true },
    points: [
      { id: 'p3_0', name: '老点0', function: 3, address: 0, scale: 0.1, unit: '℃', alarmMin: 0, alarmMax: 100 },
      { id: 'p3_1', name: '老点1', function: 3, address: 1 },
      { id: 'p1_5', name: '线圈', function: 1, address: 5 },
    ],
    values: [
      { key: 'p3_0', raw: 123, value: 12.3, ok: true, at: 1000 },
      { key: 'p3_1', raw: 456, value: 456, ok: true, at: 1001 },
    ],
    polling: { enabled: true, intervalMs: 2000, lastAt: 999, lastOk: true, error: '' },
    alarmActive: { 'p3_0': true },
    frames: [{ t: 1, label: 'old', request: 'REQ', response: 'RESP', trace: [] }],
  }
  const migrated = normalizeModbus(v2)
  assert.equal(migrated.version, 3)
  assert.equal(migrated.connections.length, 1)
  assert.equal(migrated.connections[0].id, 'c1')
  assert.equal(migrated.connections[0].conn.port, 'COM9')
  assert.equal(migrated.connections[0].conn.slave, 5)
  assert.equal(migrated.connections[0].conn.baudrate, 115200)
  assert.equal(migrated.devices.length, 1)
  assert.equal(migrated.devices[0].id, 'd1')
  assert.equal(migrated.devices[0].connectionId, 'c1')
  assert.equal(migrated.devices[0].unitId, 5)
  assert.equal(migrated.points.length, 3)
  for (const p of migrated.points) {
    assert.equal(p.connectionId, 'c1')
    assert.equal(p.deviceId, 'd1')
    assert.ok(typeof p.id === 'string' && p.id.length >= 2)
    assert.ok(['holdingRegister', 'coil', 'discreteInput', 'inputRegister'].includes(p.area))
  }
  const oldNames = new Set(['老点0', '老点1', '线圈'])
  for (const p of migrated.points) assert.ok(oldNames.has(p.name))
  // values remapped to new ids
  assert.equal(migrated.values.length, 2)
  for (const v of migrated.values) {
    assert.ok(migrated.points.some(p => p.id === v.key || p.id === v.pointId))
    assert.equal(v.connectionId, 'c1')
    assert.equal(v.deviceId, 'd1')
  }
  const oldVal = migrated.values.find(v => v.raw === 123)
  assert.ok(oldVal)
  // pollingByConnection
  assert.ok(migrated.pollingByConnection && migrated.pollingByConnection['c1'])
  assert.equal(migrated.pollingByConnection['c1'].enabled, true)
  assert.equal(migrated.pollingByConnection['c1'].intervalMs, 2000)
  // framesByConnection
  assert.ok(migrated.framesByConnection && Array.isArray(migrated.framesByConnection['c1']))
  // alarmState remapped
  assert.equal(Object.keys(migrated.alarmState).length, 1)
  const alarmKey = Object.keys(migrated.alarmState)[0]
  assert.ok(migrated.points.some(p => p.id === alarmKey))
  // active ids
  assert.equal(migrated.activeConnectionId, 'c1')
  assert.equal(migrated.activeDeviceId, 'd1')
  // via saveWorkspace legacy path
  const home = await mkdtemp(join(tmpdir(), 'dvb-v2mig-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, { modbus: v2 })
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.version, 3)
    assert.equal(ws.modbus.connections[0].id, 'c1')
    assert.equal(ws.modbus.devices[0].id, 'd1')
    assert.equal(ws.modbus.points.length, 3)
    assert.ok(ws.modbus.values.length >= 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
