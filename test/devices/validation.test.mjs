import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeModbus, validateConnections, validateDevices } from '../../bench-devices.mjs'
import { modbusPoll, modbusRead, modbusWrite } from '../../bench-modbus.mjs'
import { pointIdOf, setPointValue } from '../../bench-points.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'

test('RTU COM 全局唯一：两条 enabled 连接同 COM3 冲突被 validateConnections 阻止', async (t) => {
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
  const home = await createTempDir(t, 'dvb-com-unique-')
  const cwd = join(home, 'board')
  await mkdir(cwd)
    const first = saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [
          {
            id: 'c1',
            name: '连接1',
            role: 'client',
            enabled: true,
            conn: { mode: 'rtu', port: 'COM3', baudrate: 9600 },
          },
        ],
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
})
test('TCP listenHost:listenPort 唯一，TCP 客户端 host:port 允许复用', async (t) => {
  const serverDup = [
    {
      id: 'c1',
      name: '服务端A',
      role: 'server',
      enabled: true,
      conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 },
    },
    {
      id: 'c2',
      name: '服务端B',
      role: 'server',
      enabled: true,
      conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 },
    },
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
test('同一连接内 Unit ID 唯一校验', async (t) => {
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
  const home = await createTempDir(t, 'dvb-unit-unique-')
  const cwd = join(home, 'board')
  await mkdir(cwd)
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
})
test('同一 RTU 连接下两 Unit ID 同地址点位不串扰（p3_0 在 unit1 与 unit2 值隔离）', async (t) => {
  const home = await createTempDir(t, 'dvb-isolate-')
  const cwd = join(home, 'board')
  await mkdir(cwd)
    const c1 = {
      id: 'c1',
      name: 'COM3',
      role: 'client',
      enabled: true,
      conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true },
    }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'Unit1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c1', name: 'Unit2', unitId: 2 }
    const p1 = {
      id: 'p-d1-hr0',
      connectionId: 'c1',
      deviceId: 'd1',
      name: 'U1-HR0',
      area: 'holdingRegister',
      function: 3,
      address: 0,
    }
    const p2 = {
      id: 'p-d2-hr0',
      connectionId: 'c1',
      deviceId: 'd2',
      name: 'U2-HR0',
      area: 'holdingRegister',
      function: 3,
      address: 0,
    }
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
    const w1 = await modbusWrite(home, cwd, {
      connectionId: 'c1',
      deviceId: 'd1',
      function: 3,
      address: 0,
      values: [111],
      source: 'user',
    })
    assert.equal(w1.ok, true)
    assert.deepEqual(w1.target, [111])
    let ws = loadWorkspace(home, cwd)
    let rec1 = ws.modbus.values.find((v) => v.key === 'p-d1-hr0' || v.pointId === 'p-d1-hr0')
    let rec2 = ws.modbus.values.find((v) => v.key === 'p-d2-hr0' || v.pointId === 'p-d2-hr0')
    assert.ok(rec1 && rec1.raw === 111)
    assert.ok(!rec2 || rec2.raw !== 111)
    // sim flips to false after local write; re-enable for second write on same connection
    {
      const cur = loadWorkspace(home, cwd)
      const nextConns = cur.modbus.connections.map((c) =>
        c.id === 'c1' ? { ...c, conn: { ...c.conn, sim: true } } : c,
      )
      saveWorkspace(home, cwd, { modbus: { connections: nextConns } })
    }
    // write to d2 HR0 = 222, d1 should stay 111
    const w2 = await modbusWrite(home, cwd, {
      connectionId: 'c1',
      deviceId: 'd2',
      function: 3,
      address: 0,
      values: [222],
      source: 'user',
    })
    assert.equal(w2.ok, true)
    ws = loadWorkspace(home, cwd)
    rec1 = ws.modbus.values.find((v) => v.key === 'p-d1-hr0' || v.pointId === 'p-d1-hr0')
    rec2 = ws.modbus.values.find((v) => v.key === 'p-d2-hr0' || v.pointId === 'p-d2-hr0')
    assert.equal(rec1.raw, 111)
    assert.equal(rec2.raw, 222)
    // re-enable sim before reads
    {
      const cur = loadWorkspace(home, cwd)
      const nextConns = cur.modbus.connections.map((c) =>
        c.id === 'c1' ? { ...c, conn: { ...c.conn, sim: true } } : c,
      )
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
})
