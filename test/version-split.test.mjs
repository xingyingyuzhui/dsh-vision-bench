import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeModbus } from '../bench-devices.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'

test('Task5: schemaVersion fixed 3, configVersion increments on each connection/device/point change, evidence uses configVersion', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-version-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    // initial pack
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    saveWorkspace(home, cwd, { modbus: { version: 3, configVersion: 1, connections: [c1], devices: [d1], points: [] } })
    let ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.version, 3, 'schemaVersion should be 3')
    const base = ws.modbus.configVersion
    assert.ok(base >= 1, 'configVersion should be >=1')
    // add a point -> configVersion should bump by 1, version stays 3
    saveWorkspace(home, cwd, { modbus: { points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }], version: 3 } })
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.version, 3, 'schemaVersion stays 3 after point add')
    assert.equal(ws.modbus.configVersion, base + 1, 'configVersion should increment on point change')
    // add a device -> bump by 1
    saveWorkspace(home, cwd, { modbus: { devices: [...ws.modbus.devices, { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 }], version: 3 } })
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.version, 3)
    assert.equal(ws.modbus.configVersion, base + 2, 'configVersion should increment on device change')
    // add a connection -> bump by 1
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    saveWorkspace(home, cwd, { modbus: { connections: [...ws.modbus.connections, c2], version: 3 } })
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.version, 3)
    assert.equal(ws.modbus.configVersion, base + 3, 'configVersion should increment on connection change')
    // evidence/confirmation should use configVersion, not version
    const pack = normalizeModbus(ws.modbus)
    const expectedCv = ws.modbus.configVersion
    // run alarm/evidence/trend via tool and check they return configVersion
    let res = await runVisionBench(home, { action: 'trend', connectionId: 'c1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
    assert.equal(res.trend.configVersion, expectedCv, 'trend should return configVersion, not schemaVersion')
    res = await runVisionBench(home, { action: 'alarm', connectionId: 'c1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
    assert.equal(res.configVersion, expectedCv, 'alarm should return configVersion')
    res = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
    assert.equal(res.configVersion, expectedCv, 'evidence should return configVersion')
    // frames should also return configVersion
    res = await runVisionBench(home, { action: 'frames', connectionId: 'c1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
    assert.equal(res.configVersion, expectedCv, 'frames should return configVersion')
    // focus should return configVersion
    res = await runVisionBench(home, { action: 'focus', connectionId: 'c1', deviceId: 'd1', pointId: 'p1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
    assert.equal(res.configVersion, expectedCv, 'focus should return configVersion')
    // schemaVersion stays 3 even after many changes, and old field version fallback only at migration
    const legacy = normalizeModbus({ version: 2, conn: { mode: 'rtu', port: 'COM9', sim: true }, points: [{ id: 'p3_0', function: 3, address: 0 }] })
    assert.equal(legacy.version, 3, 'legacy v2 should migrate to schemaVersion 3')
    assert.ok(legacy.configVersion >= 1, 'legacy should have configVersion')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
