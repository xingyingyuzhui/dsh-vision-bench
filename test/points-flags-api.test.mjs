import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { mutateConfig } from '../src/application/config/config-mutation-service.mjs'
import { createVisionRpcRouter } from '../src/interfaces/rpc/vision-rpc-router.mjs'

const seedV3 = (home, cwd) => {
  mkdirSync(cwd, { recursive: true })
  const saved = saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
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
        },
      ],
      values: [],
      alarmState: {},
    },
  })
  assert.equal(saved.ok, true)
  return saved.workspace
}

const flagsUpdate = (home, cwd, pointId, patch, expectedConfigVersion) =>
  mutateConfig({
    home,
    cwd,
    expectedConfigVersion,
    operation: 'flags.update',
    target: { pointId },
    value: patch,
    source: 'user',
  }).then((ran) => {
    if (!ran.ok) return ran
    const point = (ran.workspace.modbus.points || []).find((item) => item.id === pointId)
    return { ...ran, point, configVersion: ran.nextConfigVersion }
  })

test('flags.update flips monitorEnabled, syncs trendEnabled, bumps configVersion', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    const ran = await flagsUpdate(home, cwd, 'p1', { monitorEnabled: true }, cv0)
    assert.equal(ran.ok, true)
    assert.equal(ran.point.monitorEnabled, true)
    assert.equal(ran.point.trendEnabled, true)
    assert.equal(ran.point.alarmEnabled, true, 'alarmEnabled 不变')
    assert.equal(ran.point.alarmMin, 18)
    assert.equal(ran.point.alarmMax, 30)
    assert.ok(ran.configVersion > cv0)
    const loaded = loadWorkspace(home, cwd)
    assert.equal(loaded.modbus.points[0].monitorEnabled, true)
    assert.equal(loaded.modbus.points[0].trendEnabled, true)
    assert.equal(loaded.modbus.points[0].alarmEnabled, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('flags.update rejects CONFIG_DRIFT / missing point / empty patch', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-err-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    const drift = await flagsUpdate(home, cwd, 'p1', { monitorEnabled: true }, cv0 + 99)
    assert.equal(drift.ok, false)
    assert.equal(drift.errorCode, 'CONFIG_DRIFT')

    const missing = await flagsUpdate(home, cwd, 'no-such', { alarmEnabled: false }, cv0)
    assert.equal(missing.ok, false)
    assert.equal(missing.errorCode, 'POINT_NOT_FOUND')
    assert.match(missing.error, /点位不存在/)

    const empty = await flagsUpdate(home, cwd, 'p1', {}, cv0)
    assert.equal(empty.ok, false)
    assert.match(empty.error, /monitorEnabled|alarmEnabled/)

    const badType = await flagsUpdate(home, cwd, 'p1', { monitorEnabled: 'yes' }, cv0)
    assert.equal(badType.ok, false)
    assert.match(badType.error, /布尔/)

    for (const expectedConfigVersion of [undefined, 0, -1, '2', Number.NaN]) {
      const ran = await flagsUpdate(home, cwd, 'p1', { monitorEnabled: true }, expectedConfigVersion)
      assert.equal(ran.ok, false, String(expectedConfigVersion))
      assert.equal(ran.errorCode, 'CONFIG_VERSION_REQUIRED')
    }
    const loaded = loadWorkspace(home, cwd)
    assert.equal(loaded.modbus.configVersion, cv0)
    assert.equal(loaded.modbus.points[0].monitorEnabled, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('flags.update ignores extra fields such as name and alarmMin', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-extra-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    const ran = await flagsUpdate(
      home,
      cwd,
      'p1',
      { alarmEnabled: false, name: 'hijack', alarmMin: 0, id: 'stolen' },
      cv0,
    )
    assert.equal(ran.ok, true, ran.error)
    assert.equal(ran.point.alarmEnabled, false)
    assert.equal(ran.point.name, '温度')
    assert.equal(ran.point.alarmMin, 18)
    assert.equal(ran.point.id, 'p1')
    assert.equal(ran.point.monitorEnabled, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('/points/flags returns saved point and maps CONFIG_DRIFT', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-http-'))
  const cwd = join(home, 'board')
  const { dispatch } = createVisionRpcRouter({ getHome: () => home })
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    const ran = await dispatch('points/flags', {
      cwd,
      pointId: 'p1',
      monitorEnabled: true,
      expectedConfigVersion: cv0,
    })
    assert.equal(ran.ok, true)
    assert.equal(ran.point.monitorEnabled, true)
    assert.equal(ran.point.trendEnabled, true)
    assert.equal(ran.point.alarmEnabled, true)
    assert.ok(ran.workspace && ran.workspace.modbus)
    assert.ok(ran.configVersion > cv0)
    const drift = await dispatch('points/flags', {
      cwd,
      pointId: 'p1',
      alarmEnabled: false,
      expectedConfigVersion: cv0,
    })
    assert.equal(drift.ok, false)
    assert.equal(drift.errorCode, 'CONFIG_DRIFT')
    assert.match(drift.error, /刷新后重试/)
    const missing = await dispatch('points/flags', {
      cwd,
      pointId: 'no-such',
      alarmEnabled: true,
      expectedConfigVersion: ran.configVersion,
    })
    assert.equal(missing.ok, false)
    assert.equal(missing.errorCode, 'NOT_FOUND')
    const noVersion = await dispatch('points/flags', { cwd, pointId: 'p1', monitorEnabled: true })
    assert.equal(noVersion.ok, false)
    assert.equal(noVersion.errorCode, 'CONFIG_VERSION_REQUIRED')
    assert.equal(loadWorkspace(home, cwd).modbus.configVersion, ran.configVersion)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('flags.update can flip alarmEnabled alone without touching monitor', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-alarm-'))
  const cwd = join(home, 'board')
  try {
    const ws0 = seedV3(home, cwd)
    const cv0 = ws0.modbus.configVersion
    const ran = await flagsUpdate(home, cwd, 'p1', { alarmEnabled: false }, cv0)
    assert.equal(ran.ok, true)
    assert.equal(ran.point.alarmEnabled, false)
    assert.equal(ran.point.monitorEnabled, false)
    assert.equal(ran.point.trendEnabled, false)
    assert.ok(ran.configVersion > cv0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
