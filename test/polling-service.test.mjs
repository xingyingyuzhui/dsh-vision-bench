// Task2/0.19.3: host-managed collection service — one coordinator per workspace,
// per-connection cycle, timers cleaned on stop and plugin unload.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { pollingHealth, pollingStatus, startPolling, stopAllPolling, stopPolling } from '../bench-polling-service.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'

const mkClick = () => new Promise((r) => setTimeout(r, 10))

async function setup() {
  const home = await mkdtemp(join(tmpdir(), 'ps-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [
        {
          id: 'c1',
          name: 'C1',
          role: 'client',
          enabled: true,
          conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, slave: 1, sim: true },
        },
        {
          id: 'c2',
          name: 'C2',
          role: 'client',
          enabled: true,
          conn: { mode: 'rtu', port: 'COM4', baudrate: 9600, slave: 1, sim: true },
        },
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [
        { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'P1', function: 3, address: 0, trendEnabled: true },
      ],
      values: [],
      alarmState: {},
    },
  })
  return { home, cwd }
}

test('startPolling 持久化 enabled 并启动协调器；stopPolling 停止该连接', async () => {
  const { home, cwd } = await setup()
  const ran = await startPolling(home, cwd, { connectionId: 'c1', intervalMs: 1000 })
  assert.equal(ran.ok, true)
  assert.equal(ran.enabled, true)
  assert.equal(loadWorkspace(home, cwd).modbus.pollingByConnection.c1.enabled, true)
  const st = pollingStatus(home, cwd)
  assert.equal(st.connections.c1.running, true, 'c1 协调器在跑')
  assert.equal(st.connections.c2.running, false, 'c2 未启动')
  // 一轮采集后 should 有值/样本（sim 读提交）
  await mkClick()
  const after = await new Promise((r) => setTimeout(r, 400))
  void after
  const mb = loadWorkspace(home, cwd).modbus
  assert.ok((mb.values || []).length >= 1, '采集产生了值: ' + JSON.stringify(mb.values))
  assert.ok(((mb.trend && mb.trend.p1) || []).length >= 1, '趋势采样随采集产生')
  const stop = await stopPolling(home, cwd, { connectionId: 'c1' })
  assert.equal(stop.enabled, false)
  assert.equal(pollingStatus(home, cwd).connections.c1.running, false, '停止后 timer 清理')
  await stopAllPolling()
})

test('未启用/仿真连接不计入协调器；每个工作区只有一个协调器', async () => {
  const { home, cwd } = await setup()
  const before = pollingHealth().coordinators
  await startPolling(home, cwd, { connectionId: 'c1' })
  await startPolling(home, cwd, { connectionId: 'c1' }) // 重复启动不叠加
  assert.equal(pollingHealth().coordinators, before + 1, '一个工作区一个协调器')
  const st = pollingStatus(home, cwd)
  assert.equal(st.active, true)
  await stopAllPolling()
  assert.equal(pollingHealth().coordinators, 0, 'stopAllPolling 清空全部协调器')
  assert.equal(pollingHealth().stopping, true, '卸载标记停止')
})

test('stopAllPolling 后任何 ensurePolling 不再启动新计时器', async () => {
  const { home, cwd } = await setup()
  await startPolling(home, cwd, { connectionId: 'c1' })
  stopAllPolling()
  const { ensurePolling } = await import('../bench-polling-service.mjs')
  ensurePolling(home, cwd)
  await mkClick()
  assert.equal(pollingHealth().coordinators, 0, '卸载后不复活计时器')
})

test('停用的连接不进入协调器（旧 enabled=false 迁移语义）', async () => {
  const { home, cwd } = await setup()
  const { migrateLegacyDisabled } = await import('../bench-modbus.mjs')
  saveWorkspace(home, cwd, {
    modbus: {
      connections: [
        { id: 'c1', name: 'C1', enabled: false, conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } },
        { id: 'c2', name: 'C2', enabled: true, conn: { mode: 'rtu', port: 'COM4', slave: 1, sim: true } },
      ],
      version: 3,
    },
  })
  const migrated = await migrateLegacyDisabled(home, cwd)
  assert.equal(migrated.migrated, true)
  const mb = loadWorkspace(home, cwd).modbus
  assert.equal(mb.pollingByConnection.c1.enabled, false, '自动采集被停止')
  assert.notEqual(mb.connections.find((c) => c.id === 'c1').enabled, false, '旧禁用字段被清理')
  await stopAllPolling()
})

test('F13: stopAllPolling 后调用 startPolling 可恢复采集并重新激活协调器', async () => {
  const { home, cwd } = await setup()
  await startPolling(home, cwd, { connectionId: 'c1' })
  assert.equal(pollingHealth().stopping, false)
  await stopAllPolling()
  assert.equal(pollingHealth().stopping, true)

  // After stopping, startPolling resets stopping flag and starts coordinator
  const restarted = await startPolling(home, cwd, { connectionId: 'c1', intervalMs: 500 })
  assert.equal(restarted.ok, true)
  assert.equal(restarted.running, true)
  assert.equal(pollingHealth().stopping, false)
  assert.equal(pollingStatus(home, cwd).connections.c1.running, true)

  await stopAllPolling()
})
