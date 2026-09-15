import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { sessionPack } from '../helpers/preset-fixtures.mjs'

test('P4/0.22.0: visualization action list/get + add applies component immediately', async (t) => {
  const bench = await createBench(t, { prefix: 'viz-tool-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
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
          monitorEnabled: true,
          alarmEnabled: true,
        },
      ],
      values: [{ key: 'p1', pointId: 'p1', value: 23.5, ok: true, at: Date.now() }],
      alarmState: {},
    },
  })
  let res = await runVisionBench(home, { action: 'visualization', op: 'list' }, cwd, {
    source: 'agent',
    sessionId: 's1',
  })
  assert.equal(res.ok, true)
  assert.ok(Array.isArray(res.components) && res.components.length === 0)

  const cvBefore = loadWorkspace(home, cwd).modbus.configVersion
  res = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'add',
      expectedConfigVersion: cvBefore,
      component: { name: '送风趋势', type: 'line', pointIds: ['p1'] },
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, true, res.error)
  let pack = sessionPack(home, cwd, 's1')
  assert.equal(pack.visualization.components.length, 1)
  assert.equal(pack.visualization.components[0].name, '送风趋势')
  assert.ok(pack.configVersion > cvBefore, '组件修改递增 configVersion')

  // get → 组件 + 关联点位当前值
  res = await runVisionBench(
    home,
    { action: 'visualization', op: 'get', visualizationId: pack.visualization.components[0].id },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, true)
  assert.equal(res.component.pointIds[0], 'p1')
  assert.equal(res.values[0].value, 23.5)

  res = await runVisionBench(
    home,
    { action: 'visualization', op: 'proposeRemove', visualizationId: pack.visualization.components[0].id },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'OP_REMOVED')
  assert.equal(sessionPack(home, cwd, 's1').visualization.components.length, 1)
})
test('P4/0.20.0: 非监视点位不可入库（proposeAdd 被校验拒绝）', async (t) => {
  const bench = await createBench(t, { prefix: 'viz-tool2-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '未监视',
          function: 3,
          address: 0,
          monitorEnabled: false,
        },
      ],
      values: [],
      alarmState: {},
    },
  })
  const res = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'add',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      component: { name: 'x', type: 'value', pointIds: ['p1'] },
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'VIZ_INVALID')
})
test('Task4/0.22.0: visualization update 保留 ID/order/settings；ID 冲突拒绝', async (t) => {
  const bench = await createBench(t, { prefix: 'pu-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
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
          monitorEnabled: true,
          alarmEnabled: true,
        },
      ],
      values: [],
      alarmState: {},
      visualization: {
        schemaVersion: 1,
        components: [
          {
            id: 'viz_a',
            name: '原趋势',
            type: 'line',
            pointIds: ['p1'],
            order: 3,
            settings: { windowMs: 120000, confirmWrite: true },
          },
        ],
      },
    },
  })
  const cv0 = loadWorkspace(home, cwd).modbus.configVersion
  let res = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'update',
      visualizationId: 'viz_a',
      expectedConfigVersion: cv0,
      component: { name: '改名趋势' },
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, true, res.error)
  let pack = sessionPack(home, cwd, 's1')
  const c = pack.visualization.components[0]
  assert.equal(c.id, 'viz_a', 'ID 不变')
  assert.equal(c.name, '改名趋势', '名称更新')
  assert.equal(c.type, 'line', 'type 保留')
  assert.deepEqual(c.pointIds, ['p1'], 'pointIds 保留')
  assert.equal(c.order, 3, 'order 保留')
  assert.deepEqual(c.settings, { windowMs: 120000, confirmWrite: true }, 'settings 保留')
  assert.ok(pack.configVersion > cv0, 'configVersion 增加')
  res = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'update',
      visualizationId: 'viz_a',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      component: { id: 'viz_b', name: 'x' },
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, 'VIZ_TARGET_MISMATCH')
})
