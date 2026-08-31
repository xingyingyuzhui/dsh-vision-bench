import assert from 'node:assert/strict'
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace, workspaceRepository } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { migrateVisualizationToV2 } from '../bench-visualization-model.mjs'
import { preVisualizationV2BackupPath } from '../src/infrastructure/persistence/workspace-migration.mjs'

function seedV1(home, cwd) {
  mkdirSync(cwd, { recursive: true })
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T', function: 3, address: 0, monitorEnabled: true },
      ],
      visualization: {
        schemaVersion: 1,
        components: [{ id: 'viz_a', name: '趋势', type: 'line', pointIds: ['p1'] }],
      },
    },
  })
}

function readConfig(home, cwd) {
  const dir = workspaceRepository(home).workspaceDir(cwd)
  return JSON.parse(readFileSync(join(dir, 'config.json'), 'utf8'))
}

test('v1 工作区采集写入后磁盘仍是 v1，打开页面不升级', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-v1-'))
  const cwd = join(home, 'board')
  try {
    seedV1(home, cwd)
    assert.equal(loadWorkspace(home, cwd).modbus.visualization.schemaVersion, 1)
    await workspaceRepository(home).mutateRuntime(cwd, (ws) => ({
      workspace: {
        ...ws,
        modbus: {
          ...ws.modbus,
          values: [{ pointId: 'p1', raw: 1, value: 1, ok: true, at: Date.now() }],
          alarmState: { p1: { condition: 'active' } },
          trend: { p1: { pointId: 'p1', samples: [{ at: Date.now(), value: 1, ok: true }] } },
        },
      },
    }))
    const disk = readConfig(home, cwd)
    assert.equal(disk.modbus.visualization.schemaVersion, 1)
    assert.equal(loadWorkspace(home, cwd).modbus.visualization.schemaVersion, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('第一次保存布局创建 v2 备份且后续不覆盖；备份失败则配置不变', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-bak-'))
  const cwd = join(home, 'board')
  try {
    seedV1(home, cwd)
    const dir = workspaceRepository(home).workspaceDir(cwd)
    const laid = await runVisionBench(
      home,
      {
        action: 'visualization',
        op: 'layout',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        items: [{ id: 'viz_a', x: 2, y: 1, w: 4, h: 3 }],
      },
      cwd,
      { source: 'user' },
    )
    assert.equal(laid.ok, true)
    const bak = preVisualizationV2BackupPath(dir)
    const first = readFileSync(bak, 'utf8')
    assert.match(first, /"schemaVersion": 1/)
    assert.equal(readConfig(home, cwd).modbus.visualization.schemaVersion, 2)
    assert.equal(readConfig(home, cwd).modbus.visualization.minimumPluginVersion, '0.25.1')
    assert.deepEqual(loadWorkspace(home, cwd).modbus.visualization.components[0].layout, { x: 2, y: 1, w: 4, h: 3 })

    const second = await runVisionBench(
      home,
      {
        action: 'visualization',
        op: 'layout',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        items: [{ id: 'viz_a', x: 3, y: 1, w: 4, h: 3 }],
      },
      cwd,
      { source: 'user' },
    )
    assert.equal(second.ok, true)
    assert.equal(readFileSync(bak, 'utf8'), first, '后续保存不得覆盖备份')
    assert.deepEqual(loadWorkspace(home, cwd).modbus.visualization.components[0].layout, { x: 3, y: 1, w: 4, h: 3 })
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('备份路径被占用时中止 v2 写入且配置仍为 v1', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-bakfail-'))
  const cwd = join(home, 'board')
  try {
    seedV1(home, cwd)
    const dir = workspaceRepository(home).workspaceDir(cwd)
    mkdirSync(preVisualizationV2BackupPath(dir))
    const before = readConfig(home, cwd)
    const laid = await runVisionBench(
      home,
      {
        action: 'visualization',
        op: 'layout',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        items: [{ id: 'viz_a', x: 2, y: 1, w: 4, h: 3 }],
      },
      cwd,
      { source: 'user' },
    )
    assert.equal(laid.ok, false)
    assert.equal(laid.errorCode, 'VIZ_MIGRATION_BACKUP_FAILED')
    assert.equal(readConfig(home, cwd).modbus.visualization.schemaVersion, before.modbus.visualization.schemaVersion)
    assert.equal(loadWorkspace(home, cwd).modbus.visualization.schemaVersion, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('v2 layout 重启后恢复；不支持的 schema 只读失败；备份可从旧规范化中恢复', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-restore-'))
  const cwd = join(home, 'board')
  try {
    seedV1(home, cwd)
    const laid = await runVisionBench(
      home,
      {
        action: 'visualization',
        op: 'layout',
        expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
        items: [{ id: 'viz_a', x: 2, y: 1, w: 4, h: 3 }],
      },
      cwd,
      { source: 'user' },
    )
    assert.equal(laid.ok, true)
    const reloaded = loadWorkspace(home, cwd)
    assert.equal(reloaded.modbus.visualization.schemaVersion, 2)
    assert.deepEqual(reloaded.modbus.visualization.components[0].layout, { x: 2, y: 1, w: 4, h: 3 })

    const dir = workspaceRepository(home).workspaceDir(cwd)
    const bak = JSON.parse(readFileSync(preVisualizationV2BackupPath(dir), 'utf8'))
    const dropped = migrateVisualizationToV2(
      { schemaVersion: 1, components: bak.modbus.visualization.components.map(({ layout, ...rest }) => rest) },
      reloaded.modbus.points,
    )
    assert.ok(dropped.components[0].layout)
    assert.equal(bak.modbus.visualization.schemaVersion, 1)
    assert.ok(!bak.modbus.visualization.components[0].layout, '原始备份仍是 v1 无强制 layout')

    const configPath = join(dir, 'config.json')
    const cfg = JSON.parse(readFileSync(configPath, 'utf8'))
    cfg.modbus.visualization = {
      schemaVersion: 9,
      minimumPluginVersion: '9.0.0',
      components: cfg.modbus.visualization.components,
    }
    writeFileSync(configPath, JSON.stringify(cfg, null, 2))
    const listed = await runVisionBench(home, { action: 'visualization', op: 'list' }, cwd, { source: 'agent' })
    assert.equal(listed.ok, false)
    assert.equal(listed.errorCode, 'VIZ_SCHEMA_UNSUPPORTED')
    const disk = JSON.parse(readFileSync(configPath, 'utf8'))
    assert.equal(disk.modbus.visualization.schemaVersion, 9, '只读失败不得降级覆盖')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
