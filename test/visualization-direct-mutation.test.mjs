import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { runVisionBench } from '../bench-tool.mjs'

test('visualization update/remove keep id and do not auto-delete degraded components', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
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
    },
  })
  const cv = loadWorkspace(home, cwd).modbus.configVersion
  const updated = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'update',
      visualizationId: 'viz_a',
      expectedConfigVersion: cv,
      component: { name: '趋势2' },
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(updated.ok, true)
  assert.equal(loadWorkspace(home, cwd).modbus.visualization.components[0].id, 'viz_a')
  assert.equal(loadWorkspace(home, cwd).modbus.visualization.components[0].name, '趋势2')

  const mismatch = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'update',
      visualizationId: 'viz_a',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      component: { id: 'viz_b', name: 'x' },
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(mismatch.ok, false)
  assert.equal(mismatch.errorCode, 'VIZ_TARGET_MISMATCH')

  const listed = await runVisionBench(home, { action: 'visualization', op: 'list' }, cwd, { source: 'agent' })
  assert.equal(listed.ok, true)
  assert.equal(loadWorkspace(home, cwd).modbus.visualization.schemaVersion, 2)
  assert.equal(loadWorkspace(home, cwd).modbus.version, 3)
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
  assert.deepEqual(loadWorkspace(home, cwd).modbus.visualization.components[0].layout, { x: 2, y: 1, w: 4, h: 3 })
  assert.ok(laid.nextConfigVersion > laid.previousConfigVersion)

  const missingVer = await runVisionBench(
    home,
    { action: 'visualization', op: 'layout', items: [{ id: 'viz_a', x: 0, y: 0, w: 3, h: 3 }] },
    cwd,
    { source: 'agent' },
  )
  assert.equal(missingVer.ok, false)
  assert.equal(missingVer.errorCode, 'CONFIG_VERSION_REQUIRED')

  const drift = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'layout',
      expectedConfigVersion: 1,
      items: [{ id: 'viz_a', x: 0, y: 0, w: 3, h: 3 }],
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(drift.ok, false)
  assert.equal(drift.errorCode, 'CONFIG_DRIFT')

  const emptyItems = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'layout',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      items: [],
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(emptyItems.ok, false)
  assert.equal(emptyItems.errorCode, 'LAYOUT_REQUIRED')

  const before = loadWorkspace(home, cwd).modbus.visualization.components[0].layout
  const ghost = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'layout',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      items: [{ id: 'viz_gone', x: 0, y: 0, w: 3, h: 3 }],
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(ghost.ok, false)
  assert.equal(ghost.errorCode, 'VIZ_NOT_FOUND')
  assert.deepEqual(loadWorkspace(home, cwd).modbus.visualization.components[0].layout, before)

  const bad = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'layout',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      items: [{ id: 'viz_a', x: 20, y: 0, w: 4, h: 3 }],
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(bad.ok, false)
  assert.equal(bad.errorCode, 'LAYOUT_OUT_OF_BOUNDS')
  assert.deepEqual(loadWorkspace(home, cwd).modbus.visualization.components[0].layout, before)
  await rm(home, { recursive: true, force: true })
})

test('layout 变更可被状态轮询看到', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-state-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T', function: 3, address: 0, monitorEnabled: true },
      ],
      visualization: {
        schemaVersion: 2,
        components: [{ id: 'viz_a', name: '趋势', type: 'line', pointIds: ['p1'], layout: { x: 0, y: 0, w: 6, h: 4 } }],
      },
    },
  })
  const laid = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'layout',
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      items: [{ id: 'viz_a', x: 3, y: 2, w: 4, h: 3 }],
    },
    cwd,
    { source: 'agent' },
  )
  assert.equal(laid.ok, true)
  const { subscribeState } = await import('../bench-shared.mjs')
  const got = []
  const un = subscribeState(
    async () => ({ ok: true, workspace: loadWorkspace(home, cwd) }),
    cwd,
    (data) => got.push(data),
    { sessionId: 's-layout' },
  )
  await new Promise((r) => setTimeout(r, 40))
  un()
  assert.ok(got.length >= 1)
  assert.deepEqual(got[0].workspace.modbus.visualization.components[0].layout, { x: 3, y: 2, w: 4, h: 3 })
  await rm(home, { recursive: true, force: true })
})
