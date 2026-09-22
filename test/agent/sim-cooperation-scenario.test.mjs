import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import {
  createConfigMutationService,
  mutateConfig,
} from '../../src/application/config/config-mutation-service.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import {
  clearAgentAlarmWatch,
  resetAlarmNotifyTestHooks,
  _internal as alarmInternal,
} from '../../src/application/modbus/poll-alarm-notify.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

function staticPointSnapshot(points) {
  return (points || [])
    .map((p) => ({
      id: p.id,
      connectionId: p.connectionId,
      deviceId: p.deviceId,
      name: p.name,
      function: p.function,
      address: p.address,
      monitorEnabled: p.monitorEnabled === true,
      alarmEnabled: p.alarmEnabled === true,
      scale: p.scale,
      offset: p.offset,
      unit: p.unit,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

function staticComponentSnapshot(components) {
  return (components || [])
    .map((c) => ({
      id: c.id,
      name: c.name,
      type: c.type,
      pointIds: [...(c.pointIds || [])].sort(),
      layout: c.layout ? { ...c.layout } : null,
    }))
    .sort((a, b) => String(a.id).localeCompare(String(b.id)))
}

test('sim cooperation scenario: private topology → batch CRUD → drift refresh → cleanup', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-sim-coop-' })
  const { home, cwd } = bench
  const sessionId = 'sim-coop-a'
  const origin = { source: 'agent', sessionId }

  // Empty project + private conn/points (claimed on first session touch)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [{ id: 'c1', name: 'Sim', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
      visualization: { schemaVersion: 2, components: [] },
    },
  })

  const status0 = await runVisionBench(home, { action: 'status' }, cwd, origin)
  assert.equal(status0.ok, true, status0.error)
  assert.equal(status0.modbus.points.length, 0)
  const listed0 = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, origin)
  assert.equal(listed0.ok, true)
  assert.deepEqual(listed0.points, [])
  // Private session: status counts and points list must agree
  const statusProj = projectAgentResult({ action: 'status' }, status0)
  assert.equal(statusProj.modbus.counts.points, listed0.points.length)

  const baselineCv = status0.configVersion || status0.modbus.configVersion
  const baselineTasks = (status0.tasks || []).length
  const baselineLog = (status0.log || []).length

  // 3-point batch add (alarmEnabled:false by default for non-alarm tests)
  const add = await runVisionBench(
    home,
    {
      action: 'points',
      op: 'add',
      expectedConfigVersion: baselineCv,
      connectionId: 'c1',
      deviceId: 'd1',
      points: [
        { name: 'T1', function: 3, address: 0, monitorEnabled: true, alarmEnabled: false },
        { name: 'T2', function: 3, address: 1, monitorEnabled: true, alarmEnabled: false },
        { name: 'T3', function: 3, address: 2, monitorEnabled: true, alarmEnabled: false },
      ],
    },
    cwd,
    origin,
  )
  assert.equal(add.ok, true, add.error)
  assert.equal(add.changedPointIds.length, 3)
  assert.equal(add.nextConfigVersion, baselineCv + 1)

  const afterAdd = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, origin)
  assert.equal(afterAdd.points.length, 3)
  const ids = afterAdd.points.map((/** @type {any} */ p) => p.id)
  const staticAfterAdd = staticPointSnapshot(afterAdd.points)

  const statusAfterAdd = await runVisionBench(home, { action: 'status' }, cwd, origin)
  assert.equal(statusAfterAdd.modbus.points.length, 3)
  assert.deepEqual(
    new Set(statusAfterAdd.modbus.points.map((/** @type {any} */ p) => p.id)),
    new Set(ids),
  )

  // Scratch read FC03@900 count=2 + single-point read
  const scratch = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 900, count: 2 },
    cwd,
    origin,
  )
  assert.equal(scratch.ok, true, scratch.error)
  assert.ok(Array.isArray(scratch.readings) && scratch.readings.length >= 1)
  assert.equal(scratch.readings[0].address, 900)
  assert.equal(scratch.readings[0].raw.length, 2)
  const scratchProj = projectAgentResult(
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 900, count: 2 },
    scratch,
  )
  assert.deepEqual(scratchProj.readings[0].raw, scratch.readings[0].raw)
  assert.equal(scratchProj.connectionId, 'c1')
  assert.equal('framesByConnection' in scratchProj, false)

  const single = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', pointId: ids[0] },
    cwd,
    origin,
  )
  assert.equal(single.ok, true, single.error)
  const singleProj = projectAgentResult(
    { action: 'read', connectionId: 'c1', deviceId: 'd1', pointId: ids[0] },
    single,
  )
  assert.ok(singleProj.values.some((/** @type {any} */ v) => v.pointId === ids[0] || v.key === ids[0]))
  assert.ok((singleProj.framesLog || []).length < 500)

  // Update one point
  const upd = await runVisionBench(
    home,
    {
      action: 'points',
      op: 'update',
      expectedConfigVersion: add.nextConfigVersion,
      connectionId: 'c1',
      deviceId: 'd1',
      points: [{ id: ids[0], name: 'T1-renamed' }],
    },
    cwd,
    origin,
  )
  assert.equal(upd.ok, true, upd.error)

  // Component layout add
  const vizAdd = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'add',
      expectedConfigVersion: upd.nextConfigVersion,
      component: {
        name: '趋势',
        type: 'line',
        pointIds: ids.slice(0, 2),
        layout: { x: 0, y: 0, w: 4, h: 3 },
      },
    },
    cwd,
    origin,
  )
  assert.equal(vizAdd.ok, true, vizAdd.error)
  const vizList = await runVisionBench(home, { action: 'visualization', op: 'list' }, cwd, origin)
  assert.equal(vizList.components.length, 1)
  const vizId = vizList.components[0].id
  const layout = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'layout',
      expectedConfigVersion: vizAdd.nextConfigVersion,
      visualizationId: vizId,
      items: [{ id: vizId, x: 1, y: 2, w: 5, h: 4 }],
    },
    cwd,
    origin,
  )
  assert.equal(layout.ok, true, layout.error)

  // Intentional CONFIG_DRIFT → must refresh via list, not reuse actualVersion as credential
  const stale = await runVisionBench(
    home,
    {
      action: 'points',
      op: 'update',
      expectedConfigVersion: baselineCv,
      connectionId: 'c1',
      deviceId: 'd1',
      points: [{ id: ids[1], name: 'stale' }],
    },
    cwd,
    origin,
  )
  assert.equal(stale.ok, false)
  assert.equal(stale.errorCode, 'CONFIG_DRIFT')
  assert.deepEqual(stale.refresh, { action: 'points', op: 'list' })

  const reread = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, origin)
  assert.equal(reread.ok, true)
  const freshCv = reread.configVersion
  assert.notEqual(freshCv, baselineCv)
  assert.equal(reread.points.length, 3)

  // Alarm watch subscribe → stop (isolated; no current active fault notify required here)
  const watchOn = await runVisionBench(
    home,
    { action: 'alarm', connectionId: 'c1', watch: true, pointId: ids[0] },
    cwd,
    origin,
  )
  assert.equal(watchOn.ok, true, watchOn.error)
  assert.equal(watchOn.subscription?.sessionId, sessionId)
  assert.ok(watchOn.subscription?.expiresAt > watchOn.subscription?.createdAt)

  const watchOff = await runVisionBench(
    home,
    { action: 'alarm', connectionId: 'c1', watch: false },
    cwd,
    origin,
  )
  assert.equal(watchOff.ok, true, watchOff.error)
  assert.equal(watchOff.subscription?.cleared, true)

  // Delete the three test points + visualization
  const removed = await runVisionBench(
    home,
    {
      action: 'points',
      op: 'remove',
      expectedConfigVersion: freshCv,
      connectionId: 'c1',
      deviceId: 'd1',
      ids,
    },
    cwd,
    origin,
  )
  assert.equal(removed.ok, true, removed.error)
  const vizRm = await runVisionBench(
    home,
    {
      action: 'visualization',
      op: 'remove',
      expectedConfigVersion: removed.nextConfigVersion,
      visualizationId: vizId,
    },
    cwd,
    origin,
  )
  assert.equal(vizRm.ok, true, vizRm.error)

  const finalStatus = await runVisionBench(home, { action: 'status' }, cwd, origin)
  const finalList = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, origin)
  const finalViz = await runVisionBench(home, { action: 'visualization', op: 'list' }, cwd, origin)

  // Static topology restored (empty points/components); version/history grew
  assert.deepEqual(staticPointSnapshot(finalList.points), [])
  assert.deepEqual(staticComponentSnapshot(finalViz.components), [])
  assert.ok(
    (finalStatus.configVersion || finalStatus.modbus.configVersion) > baselineCv,
    'configVersion advanced and is not rolled back',
  )
  assert.ok(
    (finalStatus.tasks || []).length >= baselineTasks,
    'tasks may grow; report separately from static restore',
  )
  assert.ok((finalStatus.log || []).length >= baselineLog)

  // UI config mutation still must not followup Agent (regression)
  const notified = []
  const service = createConfigMutationService({
    releaseConnections() {},
    notifyEvent(_h, _c, summary) {
      notified.push(summary)
    },
    listConnectionStates: async () => ({ connectionStates: [] }),
  })
  const seedCv = loadWorkspace(home, cwd).modbus.configVersion
  const uiAdd = await mutateConfig({
    home,
    cwd,
    source: 'user',
    sessionId,
    expectedConfigVersion: seedCv,
    operation: 'points.add',
    target: { connectionId: 'c1', deviceId: 'd1' },
    value: {
      point: { name: 'UI', function: 3, address: 9, monitorEnabled: false, alarmEnabled: false },
    },
  })
  assert.equal(uiAdd.ok, true, uiAdd.error)
  const uiToggle = await service.mutateConfig({
    home,
    cwd,
    source: 'user',
    sessionId,
    expectedConfigVersion: uiAdd.nextConfigVersion,
    operation: 'points.update',
    target: { connectionId: 'c1', deviceId: 'd1', pointId: uiAdd.changedPointIds[0] },
    value: { point: { id: uiAdd.changedPointIds[0], monitorEnabled: true } },
  })
  assert.equal(uiToggle.ok, true, uiToggle.error)
  assert.equal(notified.length, 0, 'ordinary UI config mutations must not followup Agent')

  assert.equal(staticAfterAdd.length, 3)
  void staticAfterAdd
  clearAgentAlarmWatch(cwd)
  alarmInternal.agentAlarmWatchByKey.clear()
  alarmInternal.deliveryLedger.clear()
  resetAlarmNotifyTestHooks()
})
