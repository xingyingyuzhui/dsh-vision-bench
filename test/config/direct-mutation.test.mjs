import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'

async function withWs(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dvb-mut-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  try {
    return await fn(home, cwd)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('points add accepts a batch array in one configVersion bump', async () => {
  await withWs(async (home, cwd) => {
    const before = loadWorkspace(home, cwd)
    const added = await mutateConfig({
      home,
      cwd,
      source: 'agent',
      sessionId: 's1',
      expectedConfigVersion: before.modbus.configVersion,
      operation: 'points.add',
      target: { connectionId: 'c1', deviceId: 'd1' },
      value: {
        points: [
          { name: '回风温度1', function: 3, address: 0, monitorEnabled: true, unit: '℃' },
          { name: '回风温度2', function: 3, address: 1, monitorEnabled: true, unit: '℃' },
          { name: '进水温度', function: 3, address: 2, monitorEnabled: true, unit: '℃' },
        ],
      },
    })
    assert.equal(added.ok, true, added.error)
    assert.equal(added.changedPointIds.length, 3)
    assert.equal(added.nextConfigVersion, before.modbus.configVersion + 1)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.points.length, 3)
    assert.equal(ws.modbus.points[0].address, 0)
    assert.equal(ws.modbus.points[2].name, '进水温度')
  })
})

test('points add/update/remove apply immediately and bump configVersion', async () => {
  await withWs(async (home, cwd) => {
    const before = loadWorkspace(home, cwd)
    const added = await mutateConfig({
      home,
      cwd,
      source: 'agent',
      sessionId: 's1',
      expectedConfigVersion: before.modbus.configVersion,
      operation: 'points.add',
      target: { connectionId: 'c1', deviceId: 'd1' },
      value: { point: { name: 'T', function: 3, address: 0, monitorEnabled: true } },
    })
    assert.equal(added.ok, true)
    assert.equal(added.changedPointIds.length, 1)
    assert.equal(added.nextConfigVersion, before.modbus.configVersion + 1)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.points.length, 1)
    assert.equal(ws.modbus.configVersion, added.nextConfigVersion)
    assert.ok(ws.timeline.some((e) => String(e.summary || '').includes('添加点位')))

    const pid = ws.modbus.points[0].id
    const updated = await mutateConfig({
      home,
      cwd,
      source: 'agent',
      expectedConfigVersion: ws.modbus.configVersion,
      operation: 'points.update',
      target: { pointId: pid },
      value: { point: { id: pid, name: 'T2', function: 3, address: 0 } },
    })
    assert.equal(updated.ok, true)
    assert.equal(loadWorkspace(home, cwd).modbus.points[0].name, 'T2')

    const cleared = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      operation: 'points.clear',
      target: {},
      value: {},
    })
    assert.equal(cleared.ok, false)
    assert.equal(cleared.errorCode, 'TARGET_REQUIRED')

    const removed = await mutateConfig({
      home,
      cwd,
      expectedConfigVersion: loadWorkspace(home, cwd).modbus.configVersion,
      operation: 'points.remove',
      target: { pointId: pid },
      value: { id: pid },
    })
    assert.equal(removed.ok, true)
    assert.equal(loadWorkspace(home, cwd).modbus.points.length, 0)
  })
})

test('visualization add is live; proposeAdd is OP_REMOVED', async () => {
  await withWs(async (home, cwd) => {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        points: [
          { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T', function: 3, address: 0, monitorEnabled: true },
        ],
      },
    })
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const added = await runVisionBench(
      home,
      {
        action: 'visualization',
        op: 'add',
        expectedConfigVersion: cv,
        component: { name: '趋势', type: 'line', pointIds: ['p1'] },
      },
      cwd,
      { source: 'agent', sessionId: 's1' },
    )
    assert.equal(added.ok, true)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.visualization.components.length, 1)

    const old = await runVisionBench(
      home,
      { action: 'visualization', op: 'proposeAdd', component: { name: 'x', type: 'value', pointIds: ['p1'] } },
      cwd,
      { source: 'agent' },
    )
    assert.equal(old.ok, false)
    assert.equal(old.errorCode, 'OP_REMOVED')
    assert.equal(loadWorkspace(home, cwd).modbus.visualization.components.length, 1)
  })
})
