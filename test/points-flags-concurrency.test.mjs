import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { mutateConfig } from '../src/application/config/config-mutation-service.mjs'

async function seed(home, cwd) {
  mkdirSync(cwd, { recursive: true })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '温度',
          function: 3,
          address: 0,
          monitorEnabled: false,
          alarmEnabled: false,
          trendEnabled: false,
          alarmMin: 1,
          alarmMax: 9,
        },
      ],
    },
  })
}

const flags = (home, cwd, patch, expectedConfigVersion) =>
  mutateConfig({
    home,
    cwd,
    expectedConfigVersion,
    operation: 'flags.update',
    target: { pointId: 'p1' },
    value: patch,
    source: 'user',
  })

const pointOf = (home, cwd) => loadWorkspace(home, cwd).modbus.points[0]

test('相同版本并发写入：一个成功，另一个 CONFIG_DRIFT，字段不丢失', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-cc-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const [a, b] = await Promise.all([
      flags(home, cwd, { monitorEnabled: true }, cv),
      flags(home, cwd, { alarmEnabled: true }, cv),
    ])
    const okCount = [a, b].filter((item) => item.ok).length
    const driftCount = [a, b].filter((item) => item.errorCode === 'CONFIG_DRIFT').length
    assert.equal(okCount, 1, 'exactly one succeeds')
    assert.equal(driftCount, 1, 'the other reports CONFIG_DRIFT')
    const pt = pointOf(home, cwd)
    if (a.ok) {
      assert.equal(pt.monitorEnabled, true)
      assert.equal(pt.trendEnabled, true)
      assert.equal(pt.alarmEnabled, false)
    } else {
      assert.equal(pt.alarmEnabled, true)
      assert.equal(pt.monitorEnabled, false)
    }
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('漂移后携带新版本重试，监视和告警都保留', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-retry-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const [a, b] = await Promise.all([
      flags(home, cwd, { monitorEnabled: true }, cv),
      flags(home, cwd, { alarmEnabled: true }, cv),
    ])
    const failed = a.ok ? b : a
    assert.equal(failed.errorCode, 'CONFIG_DRIFT')
    const next = loadWorkspace(home, cwd).modbus.configVersion
    const retryPatch = a.ok ? { alarmEnabled: true } : { monitorEnabled: true }
    const retried = await flags(home, cwd, retryPatch, next)
    assert.equal(retried.ok, true, retried.error)
    const pt = pointOf(home, cwd)
    assert.equal(pt.monitorEnabled, true)
    assert.equal(pt.trendEnabled, true)
    assert.equal(pt.alarmEnabled, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('告警先成功后监视发生漂移，重试后两者都开', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-alarm-first-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    let cv = loadWorkspace(home, cwd).modbus.configVersion
    const alarm = await flags(home, cwd, { alarmEnabled: true }, cv)
    assert.equal(alarm.ok, true)
    const stale = await flags(home, cwd, { monitorEnabled: true }, cv)
    assert.equal(stale.errorCode, 'CONFIG_DRIFT')
    cv = loadWorkspace(home, cwd).modbus.configVersion
    const retry = await flags(home, cwd, { monitorEnabled: true }, cv)
    assert.equal(retry.ok, true)
    const pt = pointOf(home, cwd)
    assert.equal(pt.alarmEnabled, true)
    assert.equal(pt.monitorEnabled, true)
    assert.equal(pt.trendEnabled, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('监视先成功后告警发生漂移，重试后两者都开', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-flags-mon-first-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    let cv = loadWorkspace(home, cwd).modbus.configVersion
    const mon = await flags(home, cwd, { monitorEnabled: true }, cv)
    assert.equal(mon.ok, true)
    const stale = await flags(home, cwd, { alarmEnabled: true }, cv)
    assert.equal(stale.errorCode, 'CONFIG_DRIFT')
    cv = loadWorkspace(home, cwd).modbus.configVersion
    const retry = await flags(home, cwd, { alarmEnabled: true }, cv)
    assert.equal(retry.ok, true)
    const pt = pointOf(home, cwd)
    assert.equal(pt.monitorEnabled, true)
    assert.equal(pt.trendEnabled, true)
    assert.equal(pt.alarmEnabled, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
