import assert from 'node:assert/strict'
import test from 'node:test'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'

test('device.create with existing id is CONFLICT; version and devices unchanged', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-mut-dup-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 's1' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
    },
  })
  const before = loadWorkspace(home, cwd)
  const ver = before.modbus.configVersion
  const ran = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: ver,
    operation: 'device.create',
    value: { id: 'd1', connectionId: 'c2', unitId: 2, name: 'dup' },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.ok(Array.isArray(ran.conflicts) && ran.conflicts[0]?.deviceId === 'd1')
  const after = loadWorkspace(home, cwd)
  assert.equal(after.modbus.configVersion, ver)
  assert.equal(after.modbus.devices.filter((d) => d.id === 'd1').length, 1)
})

test('runVisionBench config device.create duplicate preserves conflicts', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-mut-cmd-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 's1' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [],
    },
  })
  const before = loadWorkspace(home, cwd)
  const ran = await runVisionBench(
    home,
    {
      action: 'config',
      operation: 'device.create',
      expectedConfigVersion: before.modbus.configVersion,
      value: { id: 'd1', connectionId: 'c1', unitId: 9 },
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.ok(ran.conflicts?.length >= 1)
  assert.equal(loadWorkspace(home, cwd).modbus.configVersion, before.modbus.configVersion)
})

test('legal update of existing device still succeeds; unique create succeeds', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-mut-ok-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 's1' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
    },
  })
  let cv = loadWorkspace(home, cwd).modbus.configVersion
  const upd = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: cv,
    operation: 'device.update',
    target: { deviceId: 'd1' },
    value: { unitId: 3 },
  })
  assert.equal(upd.ok, true, JSON.stringify(upd))
  cv = loadWorkspace(home, cwd).modbus.configVersion
  const add = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: cv,
    operation: 'device.create',
    value: { id: 'd2', connectionId: 'c2', unitId: 2 },
  })
  assert.equal(add.ok, true, JSON.stringify(add))
  const ws = loadWorkspace(home, cwd)
  const effective = ws.modbus.sessionConfigs?.s1?.devices || ws.modbus.devices
  assert.equal(effective.find((d) => d.id === 'd1')?.unitId, 3)
  assert.ok(effective.find((d) => d.id === 'd2'))
})

test('disabled duplicate device.create is still CONFLICT', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-mut-dis-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [],
    },
  })
  const cv = loadWorkspace(home, cwd).modbus.configVersion
  const ran = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: cv,
    operation: 'device.create',
    value: { id: 'd1', connectionId: 'c1', unitId: 1, enabled: false },
  })
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, 'CONFLICT')
})

/**
 * review7 R2: conflicts[].layer/sessionId must describe the layer the write
 * actually lands in (the fold target), not "sessionId present ⇒ private".
 */
function layeredFixture(share) {
  return {
    session: { boundId: 's1' },
    modbus: {
      version: 3,
      share,
      connections: [rtuSim('c1', 'COM3')],
      devices: share.enabled && share.connections ? [device('d1', 'c1', 1)] : [],
      points: [],
      sessionConfigs: {
        s1: {
          connections: share.enabled && share.connections ? [] : [rtuSim('c1', 'COM3')],
          devices: share.enabled && share.connections ? [] : [device('d1', 'c1', 1)],
          points: [],
        },
      },
      privateClaimSessionId: 's1',
    },
  }
}

test('R2-1 shared connections 层重复创建报 shared 层、空 sessionId', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-lbl-sh-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, layeredFixture({ enabled: true, connections: true, points: false, visualization: false }))
  const ver = loadWorkspace(home, cwd).modbus.configVersion
  const ran = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: ver,
    operation: 'device.create',
    value: { id: 'd1', connectionId: 'c1', unitId: 9 },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.deepEqual(ran.conflicts, [{ layer: 'shared', sessionId: '', deviceId: 'd1', connectionIds: ['c1'] }])
  const after = loadWorkspace(home, cwd)
  assert.equal(after.modbus.configVersion, ver)
  assert.equal(after.modbus.devices.filter((d) => d.id === 'd1').length, 1)
})

test('R2-2 master 关闭时按私有层报告，不误报 shared', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-lbl-mo-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, layeredFixture({ enabled: false, connections: true, points: false, visualization: false }))
  const ver = loadWorkspace(home, cwd).modbus.configVersion
  const ran = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: ver,
    operation: 'device.create',
    value: { id: 'd1', connectionId: 'c1', unitId: 9 },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.deepEqual(ran.conflicts, [{ layer: 'private', sessionId: 's1', deviceId: 'd1', connectionIds: ['c1'] }])
  assert.equal(loadWorkspace(home, cwd).modbus.configVersion, ver)
})

test('R2-3 connections 未共享而其他类别共享：仍报 private/sid', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-lbl-nc-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, layeredFixture({ enabled: true, connections: false, points: true, visualization: false }))
  const ver = loadWorkspace(home, cwd).modbus.configVersion
  const ran = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: ver,
    operation: 'device.create',
    value: { id: 'd1', connectionId: 'c1', unitId: 9 },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.deepEqual(ran.conflicts, [{ layer: 'private', sessionId: 's1', deviceId: 'd1', connectionIds: ['c1'] }])
  assert.equal(loadWorkspace(home, cwd).modbus.configVersion, ver)
})

test('R2-4 无 session 的旧顶层重复创建报 top 层、空 sessionId', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-lbl-top-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [],
    },
  })
  const ver = loadWorkspace(home, cwd).modbus.configVersion
  const ran = await mutateConfig({
    home,
    cwd,
    expectedConfigVersion: ver,
    operation: 'device.create',
    value: { id: 'd1', connectionId: 'c1', unitId: 9 },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.deepEqual(ran.conflicts, [{ layer: 'top', sessionId: '', deviceId: 'd1', connectionIds: ['c1'] }])
  assert.equal(loadWorkspace(home, cwd).modbus.configVersion, ver)
})

test('R2-5 共享层冲突经 config handler 与 Agent projection 后层信息仍正确', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-lbl-hd-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, layeredFixture({ enabled: true, connections: true, points: false, visualization: false }))
  const ver = loadWorkspace(home, cwd).modbus.configVersion
  const ran = await runVisionBench(
    home,
    {
      action: 'config',
      operation: 'device.create',
      expectedConfigVersion: ver,
      value: { id: 'd1', connectionId: 'c1', unitId: 9 },
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.equal(ran.conflicts?.[0]?.layer, 'shared')
  assert.equal(ran.conflicts?.[0]?.sessionId, '')
  assert.equal(ran.conflicts?.[0]?.deviceId, 'd1')
  assert.deepEqual(ran.conflicts?.[0]?.connectionIds, ['c1'])
  assert.equal(loadWorkspace(home, cwd).modbus.configVersion, ver)
  const projected = projectAgentResult({ action: 'config' }, ran)
  assert.equal(projected.errorCode, 'CONFLICT')
  assert.equal(projected.conflicts?.[0]?.layer, 'shared')
  assert.equal(projected.conflicts?.[0]?.sessionId, '')
})
