import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, patchPointFlags, saveWorkspace } from '../bench-store.mjs'

const seedV3 = (home, cwd) => {
  mkdirSync(cwd, { recursive: true })
  const saved = saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [{
        id: 'p1',
        connectionId: 'c1',
        deviceId: 'd1',
        name: '温度',
        function: 3,
        address: 0,
        scale: 0.1,
        offset: 0,
        unit: '℃',
        monitorEnabled: false,
        alarmEnabled: true,
        alarmMin: 18,
        alarmMax: 30,
      }],
      values: [],
      alarmState: {},
    },
  })
  assert.equal(saved.ok, true)
  return saved.workspace
}

test('patchPointFlags flips monitorEnabled, syncs trendEnabled, bumps configVersion', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    assert.equal(ws0.modbus.points[0].monitorEnabled, false)
    assert.equal(ws0.modbus.points[0].alarmEnabled, true)

    const ran = patchPointFlags(home, cwd, 'p1', { monitorEnabled: true }, { expectedConfigVersion: cv0 })
    assert.equal(ran.ok, true)
    assert.equal(ran.point.monitorEnabled, true)
    assert.equal(ran.point.trendEnabled, true)
    assert.equal(ran.point.alarmEnabled, true, 'alarmEnabled 不变')
    assert.equal(ran.point.alarmMin, 18)
    assert.equal(ran.point.alarmMax, 30)
    assert.equal(ran.point.connectionId, 'c1')
    assert.equal(ran.point.address, 0)
    assert.ok(ran.configVersion > cv0, 'configVersion 应递增')
    assert.equal(ran.workspace.modbus.configVersion, ran.configVersion)

    const loaded = loadWorkspace(home, cwd)
    assert.equal(loaded.modbus.points[0].monitorEnabled, true)
    assert.equal(loaded.modbus.points[0].trendEnabled, true)
    assert.equal(loaded.modbus.points[0].alarmEnabled, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('patchPointFlags rejects CONFIG_DRIFT / missing point / empty patch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-err-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion

    const drift = patchPointFlags(home, cwd, 'p1', { monitorEnabled: true }, { expectedConfigVersion: cv0 + 99 })
    assert.equal(drift.ok, false)
    assert.equal(drift.errorCode, 'CONFIG_DRIFT')
    assert.match(drift.error, /刷新/)

    const missing = patchPointFlags(home, cwd, 'no-such', { alarmEnabled: false }, { expectedConfigVersion: cv0 })
    assert.equal(missing.ok, false)
    assert.equal(missing.errorCode, 'NOT_FOUND')
    assert.match(missing.error, /点位不存在/)

    const empty = patchPointFlags(home, cwd, 'p1', {}, { expectedConfigVersion: cv0 })
    assert.equal(empty.ok, false)
    assert.match(empty.error, /monitorEnabled|alarmEnabled/)

    const neither = patchPointFlags(home, cwd, 'p1', { monitorEnabled: undefined, alarmEnabled: undefined }, { expectedConfigVersion: cv0 })
    assert.equal(neither.ok, false)

    const badType = patchPointFlags(home, cwd, 'p1', { monitorEnabled: 'yes' }, { expectedConfigVersion: cv0 })
    assert.equal(badType.ok, false)
    assert.match(badType.error, /布尔/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('patchPointFlags can flip alarmEnabled alone without touching monitor', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-alarm-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    const ran = patchPointFlags(home, cwd, 'p1', { alarmEnabled: false }, { expectedConfigVersion: cv0 })
    assert.equal(ran.ok, true)
    assert.equal(ran.point.alarmEnabled, false)
    assert.equal(ran.point.monitorEnabled, false)
    assert.equal(ran.point.trendEnabled, false)
    assert.ok(ran.configVersion > cv0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
