import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { applyPointPatch } from '../../src/domain/modbus/point-patch.mjs'

async function withWs(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dvb-pp-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        { id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } },
        { id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '127.0.0.2', sim: true } },
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: 'T',
          function: 3,
          address: 10,
          scale: 0.1,
          offset: 2,
          unit: 'C',
          monitorEnabled: true,
          alarmEnabled: true,
          alarmMin: 1,
          alarmMax: 90,
        },
      ],
      visualization: {
        schemaVersion: 1,
        components: [
          {
            id: 'viz_a',
            name: '趋势',
            type: 'line',
            pointIds: ['p1'],
            order: 1,
            settings: { windowMs: 300000, confirmWrite: true },
          },
        ],
      },
      values: [{ pointId: 'p1', key: 'p1', raw: 5, value: 2.5, ok: true, at: 1 }],
      alarmState: { p1: { condition: 'active' } },
      trend: { p1: [[1, 2.5]] },
    },
  })
  try {
    return await fn(home, cwd)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

function snapshotPoint(ws) {
  return { ...ws.modbus.points[0] }
}

test('flags.update without a positive integer version does not write', async () => {
  await withWs(async (home, cwd) => {
    const before = snapshotPoint(loadWorkspace(home, cwd))
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const ran = await mutateConfig({
      home,
      cwd,
      operation: 'flags.update',
      target: { pointId: 'p1' },
      value: { monitorEnabled: false },
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'CONFIG_VERSION_REQUIRED')
    const after = loadWorkspace(home, cwd)
    assert.equal(after.modbus.configVersion, cv)
    assert.equal(after.modbus.points[0].monitorEnabled, before.monitorEnabled)
  })
})

test('applyPointPatch: monitor syncs trend; alarm-only leaves monitor/trend; ids frozen', () => {
  const base = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: 'T',
    monitorEnabled: false,
    trendEnabled: false,
    alarmEnabled: true,
    alarmMin: 1,
    alarmMax: 9,
  }
  const mon = applyPointPatch(base, { monitorEnabled: true })
  assert.equal(mon.ok, true)
  assert.equal(mon.point.monitorEnabled, true)
  assert.equal(mon.point.trendEnabled, true)
  assert.equal(mon.point.alarmEnabled, true)
  assert.equal(mon.point.alarmMin, 1)
  const off = applyPointPatch(mon.point, { monitorEnabled: false })
  assert.equal(off.point.monitorEnabled, false)
  assert.equal(off.point.trendEnabled, false)
  assert.equal(off.point.alarmEnabled, true)
  const alarm = applyPointPatch(mon.point, { alarmEnabled: false })
  assert.equal(alarm.point.alarmEnabled, false)
  assert.equal(alarm.point.monitorEnabled, true)
  assert.equal(alarm.point.trendEnabled, true)
  const frozen = applyPointPatch(base, { id: 'stolen' })
  assert.equal(frozen.ok, false)
  assert.equal(frozen.errorCode, 'TARGET_MISMATCH')
})

test('applyPointPatch: trendEnabled alias alone; same-value dual ok; conflict → FIELD_CONFLICT', () => {
  const base = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: 'T',
    monitorEnabled: false,
    trendEnabled: false,
    alarmEnabled: false,
  }
  const alias = applyPointPatch(base, { trendEnabled: true })
  assert.equal(alias.ok, true)
  assert.equal(alias.point.monitorEnabled, true)
  assert.equal(alias.point.trendEnabled, true)

  const same = applyPointPatch(base, { monitorEnabled: true, trendEnabled: true })
  assert.equal(same.ok, true)
  assert.equal(same.point.monitorEnabled, true)
  assert.equal(same.point.trendEnabled, true)

  const conflict = applyPointPatch(base, { monitorEnabled: true, trendEnabled: false })
  assert.equal(conflict.ok, false)
  assert.equal(conflict.errorCode, 'FIELD_CONFLICT')
  assert.equal(base.monitorEnabled, false, 'conflict must not mutate input')
})

test('batch points.update fails atomically on FIELD_CONFLICT and leaves version unchanged', async () => {
  await withWs(async (home, cwd) => {
    const before = loadWorkspace(home, cwd)
    const cv = before.modbus.configVersion
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: {
        points: [{ id: 'p1', monitorEnabled: true, trendEnabled: false }],
      },
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'FIELD_CONFLICT')
    const after = loadWorkspace(home, cwd)
    assert.equal(after.modbus.configVersion, cv)
    assert.equal(after.modbus.points[0].monitorEnabled, true)
  })
})

test('points.add rejects FIELD_CONFLICT dual fields; version and table unchanged', async () => {
  await withWs(async (home, cwd) => {
    const before = loadWorkspace(home, cwd)
    const cv = before.modbus.configVersion
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.add',
      target: { connectionId: 'c1', deviceId: 'd1' },
      value: {
        points: [{ name: 'X', function: 3, address: 99, monitorEnabled: true, trendEnabled: false }],
      },
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'FIELD_CONFLICT')
    const after = loadWorkspace(home, cwd)
    assert.equal(after.modbus.configVersion, cv)
    assert.equal(after.modbus.points.length, before.modbus.points.length)
  })
})

test('batch points.add is atomic: one FIELD_CONFLICT aborts entire batch', async () => {
  await withWs(async (home, cwd) => {
    const before = loadWorkspace(home, cwd)
    const cv = before.modbus.configVersion
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.add',
      target: { connectionId: 'c1', deviceId: 'd1' },
      value: {
        points: [
          { name: 'A', function: 3, address: 20, monitorEnabled: true },
          { name: 'B', function: 3, address: 21, monitorEnabled: true, trendEnabled: false },
          { name: 'C', function: 3, address: 22, monitorEnabled: true },
        ],
      },
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'FIELD_CONFLICT')
    const after = loadWorkspace(home, cwd)
    assert.equal(after.modbus.configVersion, cv)
    assert.equal(after.modbus.points.length, before.modbus.points.length)
    assert.equal(
      after.modbus.points.some((p) => p.address === 20 || p.address === 22),
      false,
      'no partial adds',
    )
  })
})

test('CONFIG_DRIFT includes machine-readable refresh hint', async () => {
  await withWs(async (home, cwd) => {
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const drift = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv + 9,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { point: { id: 'p1', name: 'nope' } },
    })
    assert.equal(drift.ok, false)
    assert.equal(drift.errorCode, 'CONFIG_DRIFT')
    assert.deepEqual(drift.refresh, { action: 'points', op: 'list' })
    assert.deepEqual(drift.details.refresh, { action: 'points', op: 'list' })
    assert.equal(typeof drift.details.actualVersion, 'number')
    // actualVersion is diagnostic only — Agent must follow refresh (re-list), not treat it as a retry ticket.
    assert.notEqual(drift.refresh, drift.details.actualVersion)
    assert.equal('expectedConfigVersion' in (drift.refresh || {}), false)
  })
})

test('name-only update does not reset address/function/scale/flags', async () => {
  await withWs(async (home, cwd) => {
    const before = snapshotPoint(loadWorkspace(home, cwd))
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { point: { id: 'p1', name: 'T-air' } },
    })
    assert.equal(ran.ok, true, ran.error)
    const after = snapshotPoint(loadWorkspace(home, cwd))
    assert.equal(after.name, 'T-air')
    assert.equal(after.address, before.address)
    assert.equal(after.function, before.function)
    assert.equal(after.scale, before.scale)
    assert.equal(after.offset, before.offset)
    assert.equal(after.unit, before.unit)
    assert.equal(after.monitorEnabled, true)
    assert.equal(after.alarmEnabled, true)
    assert.equal(after.alarmMin, 1)
    assert.equal(after.alarmMax, 90)
    assert.equal(after.connectionId, 'c1')
    assert.equal(after.deviceId, 'd1')
  })
})

test('threshold-only and monitor-only patches are independent', async () => {
  await withWs(async (home, cwd) => {
    let cv = loadWorkspace(home, cwd).modbus.configVersion
    let ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { point: { id: 'p1', alarmMin: 5, alarmMax: 70 } },
    })
    assert.equal(ran.ok, true, ran.error)
    let pt = loadWorkspace(home, cwd).modbus.points[0]
    assert.equal(pt.alarmMin, 5)
    assert.equal(pt.alarmMax, 70)
    assert.equal(pt.monitorEnabled, true)
    assert.equal(pt.name, 'T')
    cv = loadWorkspace(home, cwd).modbus.configVersion
    ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { point: { id: 'p1', monitorEnabled: false } },
    })
    assert.equal(ran.ok, true, ran.error)
    pt = loadWorkspace(home, cwd).modbus.points[0]
    assert.equal(pt.monitorEnabled, false)
    assert.equal(pt.alarmEnabled, true)
    assert.equal(pt.alarmMin, 5)
  })
})

test('mismatched connection/device on update/remove is TARGET_MISMATCH', async () => {
  await withWs(async (home, cwd) => {
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const moved = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.update',
      target: { connectionId: 'c2', deviceId: 'd2', pointId: 'p1' },
      value: { point: { id: 'p1', name: 'stolen' } },
    })
    assert.equal(moved.ok, false)
    assert.equal(moved.errorCode, 'TARGET_MISMATCH')
    assert.equal(loadWorkspace(home, cwd).modbus.points[0].connectionId, 'c1')

    const removed = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      operation: 'points.remove',
      target: { connectionId: 'c2', deviceId: 'd2', pointId: 'p1' },
      value: { id: 'p1' },
    })
    assert.equal(removed.ok, false)
    assert.equal(removed.errorCode, 'TARGET_MISMATCH')
    assert.equal(loadWorkspace(home, cwd).modbus.points.length, 1)
  })
})

test('clear rejects device that does not belong to the connection', async () => {
  await withWs(async (home, cwd) => {
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      operation: 'points.clear',
      target: { connectionId: 'c1', deviceId: 'd2' },
      value: {},
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, 'TARGET_MISMATCH')
    assert.equal(loadWorkspace(home, cwd).modbus.points.length, 1)
  })
})

test('removing a point clears runtime but keeps degraded visualization', async () => {
  await withWs(async (home, cwd) => {
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      operation: 'points.remove',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { id: 'p1' },
    })
    assert.equal(ran.ok, true, ran.error)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.points.length, 0)
    assert.equal((ws.modbus.values || []).length, 0)
    assert.equal(ws.modbus.trend?.p1, undefined)
    assert.equal(ws.modbus.alarmState?.p1, undefined)
    assert.equal(ws.modbus.visualization.components[0].id, 'viz_a')
  })
})

test('updating point function code persists and synchronizes area without reverting on reload', async () => {
  await withWs(async (home, cwd) => {
    const before = loadWorkspace(home, cwd)
    assert.equal(before.modbus.points[0].function, 3)
    assert.equal(before.modbus.points[0].area, 'holdingRegister')

    // Update function from 3 (holdingRegister) to 4 (inputRegister)
    const cv = before.modbus.configVersion
    const ran = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { points: [{ id: 'p1', function: 4 }] },
    })
    assert.equal(ran.ok, true, ran.error)

    // Verify reloaded from disk
    const after = loadWorkspace(home, cwd)
    assert.equal(after.modbus.points[0].function, 4, 'function code must be 4')
    assert.equal(after.modbus.points[0].area, 'inputRegister', 'area must be synchronized to inputRegister')

    // Update function from 4 to 1 (coil)
    const cv2 = after.modbus.configVersion
    const ran2 = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: cv2,
      operation: 'points.update',
      target: { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
      value: { points: [{ id: 'p1', function: 1 }] },
    })
    assert.equal(ran2.ok, true, ran2.error)

    const after2 = loadWorkspace(home, cwd)
    assert.equal(after2.modbus.points[0].function, 1, 'function code must be 1')
    assert.equal(after2.modbus.points[0].area, 'coil', 'area must be synchronized to coil')
  })
})

test('applyPointPatch rejects a negative or non-finite alarmDeadband and keeps 0', () => {
  const base = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: 'T',
    alarmEnabled: true,
    alarmMax: 1,
  }
  const negative = applyPointPatch(base, { alarmDeadband: -0.1 })
  assert.equal(negative.ok, false)
  assert.equal(negative.errorCode, 'INVALID_FIELD')
  assert.equal(base.alarmDeadband, undefined, 'rejected patch must not mutate the input')
  const nan = applyPointPatch(base, { alarmDeadband: Number.NaN })
  assert.equal(nan.ok, false)
  assert.equal(nan.errorCode, 'INVALID_FIELD')
  const blank = applyPointPatch(base, { alarmDeadband: '' })
  assert.equal(blank.ok, true)
  assert.equal(blank.point.alarmDeadband, null)
  const zero = applyPointPatch(base, { alarmDeadband: 0 })
  assert.equal(zero.ok, true)
  assert.equal(zero.point.alarmDeadband, 0)
})

