import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { connLabel, normalizeConn, normalizeModbus, patchConn } from '../bench-devices.mjs'
import { connectOp, pickConnPatch } from '../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'

test('连接端点不再持久化 slave；connLabel 不含站号', () => {
  const c = normalizeConn({ port: 'COM3', baudrate: 9600, slave: 9 })
  assert.equal(c.slave, undefined)
  assert.ok(!('slave' in c))
  assert.equal(connLabel(c), 'COM3 @ 9600')
  assert.ok(!/站号/.test(connLabel(c)))
})

test('patchConn / pickConnPatch 忽略 slave，不改设备 Unit ID', () => {
  const base = normalizeModbus({
    version: 3,
    connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', baudrate: 9600 } }],
    devices: [
      { id: 'd1', connectionId: 'c1', name: 'A', unitId: 1 },
      { id: 'd2', connectionId: 'c1', name: 'B', unitId: 2 },
    ],
    points: [],
    activeConnectionId: 'c1',
    activeDeviceId: 'd1',
  })
  const next = patchConn(base, { baudrate: 19200, slave: 99 })
  assert.equal(next.connections[0].conn.baudrate, 19200)
  assert.equal(next.connections[0].conn.slave, undefined)
  assert.equal(next.devices.find((d) => d.id === 'd1').unitId, 1)
  assert.equal(next.devices.find((d) => d.id === 'd2').unitId, 2)
  assert.equal(pickConnPatch({ slave: 3, baudrate: 4800 }).slave, undefined)
  assert.equal(pickConnPatch({ slave: 3, baudrate: 4800 }).baudrate, 4800)
})

test('保存连接配置（workspace）不改写同连接下多个设备的 Unit ID', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-unit-own-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 7 } }],
        devices: [
          { id: 'd1', connectionId: 'c1', name: '设备1', unitId: 1 },
          { id: 'd2', connectionId: 'c1', name: '设备2', unitId: 2 },
        ],
        points: [
          { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T1', function: 3, address: 0 },
          { id: 'p2', connectionId: 'c1', deviceId: 'd2', name: 'T2', function: 3, address: 0 },
        ],
      },
    })
    let ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.connections[0].conn.slave, undefined)
    assert.equal(ws.modbus.devices.find((d) => d.id === 'd1').unitId, 1)
    assert.equal(ws.modbus.devices.find((d) => d.id === 'd2').unitId, 2)

    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: '主板', conn: { mode: 'rtu', port: 'COM4', baudrate: 115200 } }],
        devices: ws.modbus.devices,
      },
    })
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.connections[0].conn.port, 'COM4')
    assert.equal(ws.modbus.connections[0].conn.baudrate, 115200)
    assert.equal(ws.modbus.devices.find((d) => d.id === 'd1').unitId, 1)
    assert.equal(ws.modbus.devices.find((d) => d.id === 'd2').unitId, 2)
    // 同连接下允许相同功能码+地址（归属不同设备）
    assert.equal(ws.modbus.points.filter((p) => p.function === 3 && p.address === 0).length, 2)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('connect 带 slave 必须提供 deviceId；只更新该设备 unitId', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-conn-slave-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true } }],
        devices: [
          { id: 'd1', connectionId: 'c1', name: 'A', unitId: 1 },
          { id: 'd2', connectionId: 'c1', name: 'B', unitId: 2 },
        ],
        points: [],
      },
    })
    const denied = await connectOp(home, cwd, { connectionId: 'c1', slave: 5, sim: true })
    assert.equal(denied.ok, false)
    assert.equal(denied.code, 'DEVICE_ID_REQUIRED')

    const ok = await connectOp(home, cwd, { connectionId: 'c1', deviceId: 'd2', slave: 9, sim: true })
    assert.equal(ok.ok, true)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.connections[0].conn.slave, undefined)
    assert.equal(ws.modbus.devices.find((d) => d.id === 'd1').unitId, 1)
    assert.equal(ws.modbus.devices.find((d) => d.id === 'd2').unitId, 9)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
