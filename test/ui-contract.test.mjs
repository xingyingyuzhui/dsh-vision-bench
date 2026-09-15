// Task10/0.19.2: UI contract — single shared value store drives table/monitor/trend/alarm.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { modbusPoll } from '../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'

test('Task10: 一次读取同步进入 点表值/监视/曲线/告警（单一实时值来源）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uc-'))
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
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '温度',
          function: 3,
          address: 0,
          count: 1,
          active: true,
          watched: true,
          alarmMin: 60,
          alarmMax: 80,
        },
      ],
      values: [],
      alarmState: {},
      pollPlan: { auto: true, connections: {} },
    },
  })
  const ran = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0 },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, true)
  const ws = loadWorkspace(home, cwd).modbus
  const rec = (ws.values || []).find((v) => v.key === 'p1' || v.pointId === 'p1')
  assert.ok(rec && rec.value != null, 'point table current value updated: ' + JSON.stringify(rec && rec.value))
  const list = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, { source: 'agent', sessionId: 's1' })
  const prow = ((list && list.points) || []).find((p) => p.id === 'p1')
  assert.ok(prow && prow.value != null, 'agent points view carries the shared current value')
  const wsAfter = loadWorkspace(home, cwd).modbus
  const recAfter = (wsAfter.values || []).find((v) => v.key === 'p1' || v.pointId === 'p1')
  assert.equal(prow.value, recAfter && recAfter.value, 'points view and value store agree at the same moment')
  let alarm = loadWorkspace(home, cwd).modbus.alarmActive || {}
  assert.ok(
    Object.keys(alarm).length > 0,
    'over-limit value triggered alarm from shared flow: ' + JSON.stringify(alarm),
  )
  await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [70] },
    cwd,
    { source: 'manual', sessionId: 's1' },
  )
  alarm = loadWorkspace(home, cwd).modbus.alarmActive || {}
  const rec2 = alarm.p1 || alarm['p1']
  assert.ok(!rec2 || rec2.status === 'recovered', 'back-in-band value recovered the alarm: ' + JSON.stringify(alarm))
  await rm(home, { recursive: true, force: true })
})

test('Task10: 轮询环路每 cwd 只有一条（并发触发返回 skipped busy，不叠加）', async () => {
  const home = await mkdtemp(join(tmpdir(), 'uc2-'))
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
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '温度',
          function: 3,
          address: 0,
          count: 1,
          active: true,
          watched: true,
        },
      ],
      values: [],
      alarmState: {},
      pollPlan: { auto: true, connections: {} },
    },
  })
  const [a1, busy] = await Promise.all([
    modbusPoll(home, cwd, { budgetMs: 120 }),
    modbusPoll(home, cwd, { budgetMs: 120 }),
  ])
  assert.equal(a1.ok, true)
  assert.ok(
    busy.skipped === true || busy.busy === true || busy.error === '无可用连接',
    'duplicate loop must not stack: ' + JSON.stringify(busy && { skipped: busy.skipped, busy: busy.busy }),
  )
  await rm(home, { recursive: true, force: true })
})
