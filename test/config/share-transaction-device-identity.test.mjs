import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'
import { rawMutationHarness } from '../helpers/raw-mutation-repo.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { RAW_CWD, RAW_HOME, SHARE_OFF, clone, privateTwinD1, sharedTwinD1 } from '../helpers/share-raw-fixtures.mjs'

/**
 * share.update through the REAL mutation transaction (review7 R1).
 *
 * The repository fake hands the raw fixture to the real callback and commits
 * only on ok, so these assertions cover the transaction entry — not just a
 * direct applyShareFlags call. Conflict layer/sessionId reporting lives in
 * share-transaction-conflict-reporting.test.mjs (review7 R2).
 */

test('R1-1 已分区：私有层原始双 d1 发布 connections 被拒绝且事务不提交', async () => {
  const fixture = privateTwinD1()
  const before = clone(fixture)
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 5,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.equal(ran.conflicts?.[0]?.deviceId, 'd1')
  assert.deepEqual(ran.conflicts?.[0]?.connectionIds, ['c1', 'c2'])
  assert.equal(log.commits, 0, 'rejected mutation must not commit')
  assert.deepEqual(fixture, before, 'input fixture must not be mutated')
  assert.equal(fixture.modbus.sessionConfigs.s1.devices.length, 2, 'both raw d1 rows must still be present')
})

test('R1-2 已有 claim 标记：claimed=false 也不得在作用域解析阶段提前去重', async () => {
  const fixture = privateTwinD1('s1')
  const before = clone(fixture)
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 5,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.equal(ran.conflicts?.[0]?.deviceId, 'd1')
  assert.equal(log.commits, 0, 'rejected mutation must not commit')
  assert.deepEqual(fixture, before, 'input fixture must not be mutated')
  assert.equal(fixture.modbus.sessionConfigs.s1.devices.length, 2, 'claimed=false must not dedupe the raw rows')
})

test('R1-3 legacy 顶层双 d1 首次 share.update：拒绝且 claim 不落盘', async () => {
  const fixture = {
    modbus: {
      version: 3,
      share: { ...SHARE_OFF },
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1), device('d1', 'c2', 2)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
      sessionConfigs: {},
      privateClaimSessionId: '',
      configVersion: 3,
    },
  }
  const before = clone(fixture)
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 3,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.equal(ran.conflicts?.[0]?.deviceId, 'd1')
  assert.equal(log.commits, 0, 'rejected mutation must not commit')
  assert.deepEqual(fixture, before, 'claim must not land on a rejected candidate')
  assert.equal(fixture.modbus.privateClaimSessionId, '', 'claim marker must not persist')
  assert.deepEqual(fixture.modbus.sessionConfigs, {})
  assert.equal(fixture.modbus.devices.length, 2, 'claim must not drop the second d1 row')
})

test('R1-4 legacy 合法拓扑首次 claim+发布/撤销：设备、点位、unitId 与版本正确', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-share-legacy-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    session: { boundId: 's1' },
    modbus: {
      version: 3,
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 7, 'REAL-D1')],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
    },
  })
  const cv0 = loadWorkspace(home, cwd).modbus.configVersion
  const pub = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: cv0,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(pub.ok, true, JSON.stringify(pub))
  assert.deepEqual(pub.published, ['connections'])
  assert.equal(pub.configVersion, cv0 + 1)
  assert.deepEqual((pub.connections || []).map((c) => c.id), ['c1'])
  assert.equal((pub.devices || []).find((d) => d.id === 'd1')?.unitId, 7)
  assert.ok((pub.points || []).find((p) => p.id === 'p1'))
  const ws1 = loadWorkspace(home, cwd)
  assert.equal(ws1.modbus.privateClaimSessionId, 's1')
  assert.deepEqual(
    ws1.modbus.devices.map((d) => `${d.id}:${d.unitId}`),
    ['d1:7'],
  )

  const rev = await mutateConfig({
    home,
    cwd,
    sessionId: 's1',
    expectedConfigVersion: pub.configVersion,
    operation: 'share.update',
    value: { enabled: true, connections: false, confirmed: true },
  })
  assert.equal(rev.ok, true, JSON.stringify(rev))
  assert.deepEqual(rev.revoked, ['connections'])
  assert.equal(rev.configVersion, cv0 + 2)
  assert.equal((rev.devices || []).find((d) => d.id === 'd1')?.unitId, 7)
  assert.ok((rev.points || []).find((p) => p.id === 'p1'))
  const ws2 = loadWorkspace(home, cwd)
  assert.deepEqual(
    ws2.modbus.sessionConfigs.s1.devices.map((d) => `${d.id}:${d.unitId}`),
    ['d1:7'],
  )
  assert.ok(
    !(ws2.modbus.devices || []).some((d) => d.name === 'REAL-D1'),
    'revoke moves the real rows into the private layer and clears the shared slice',
  )
})

test('R1-5 共享层原始双 d1 撤销 connections 被拒绝：私有层与共享层均不变', async () => {
  const fixture = sharedTwinD1()
  const before = clone(fixture)
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 7,
    operation: 'share.update',
    value: { enabled: true, connections: false, confirmed: true },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'CONFLICT')
  assert.equal(ran.conflicts?.[0]?.deviceId, 'd1')
  assert.equal(log.commits, 0, 'rejected mutation must not commit')
  assert.deepEqual(fixture, before, 'input fixture must not be mutated')
  assert.deepEqual(fixture.modbus.sessionConfigs.s1.devices, [], 'shared twins must not land in the private layer')
  assert.equal(fixture.modbus.devices.length, 2, 'shared layer must not be cleared')
})

test('R1-6 撤销未确认：维持既有确认错误，不新增确认流程', async () => {
  const fixture = {
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: false, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [],
      sessionConfigs: { s1: { connections: [], devices: [], points: [] } },
      privateClaimSessionId: 's1',
      configVersion: 7,
    },
  }
  const before = clone(fixture)
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 7,
    operation: 'share.update',
    value: { enabled: true, connections: false },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  assert.equal(ran.errorCode, 'SHARE_REVOKE_CONFIRM_REQUIRED')
  assert.equal(ran.needsConfirm, true)
  assert.deepEqual(ran.revoked, ['connections'])
  assert.equal(log.commits, 0)
  assert.deepEqual(fixture, before, 'input fixture must not be mutated')
})

test('R1-7 发布是替换：共享旧单 d1 被私有新单 d1 替换不误判重复', async () => {
  const fixture = {
    modbus: {
      version: 3,
      share: { ...SHARE_OFF },
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [device('d1', 'c1', 1)],
      points: [],
      sessionConfigs: {
        s1: { connections: [rtuSim('c2', 'COM4')], devices: [device('d1', 'c2', 2)], points: [] },
      },
      privateClaimSessionId: 's1',
      configVersion: 4,
    },
  }
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 4,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(ran.ok, true, JSON.stringify(ran))
  assert.deepEqual(ran.published, ['connections'])
  assert.equal(log.commits, 1)
  assert.deepEqual(
    (ran.devices || []).map((d) => `${d.id}:${d.connectionId}:${d.unitId}`),
    ['d1:c2:2'],
    'candidate layer holds only the new definition',
  )
})

test('R1-8 无关会话的双 d1 不阻塞发布合法当前层', async () => {
  const fixture = {
    modbus: {
      version: 3,
      share: { ...SHARE_OFF },
      connections: [rtuSim('c1', 'COM3'), rtuSim('c2', 'COM4')],
      devices: [],
      points: [],
      sessionConfigs: {
        s1: { connections: [rtuSim('c1', 'COM3')], devices: [device('d1', 'c1', 1)], points: [] },
        s2: {
          connections: [rtuSim('c1', 'COM3')],
          devices: [device('d1', 'c1', 9), device('d1', 'c2', 8)],
          points: [],
        },
      },
      privateClaimSessionId: 's1',
      configVersion: 6,
    },
  }
  const { service, log } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 6,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(ran.ok, true, JSON.stringify(ran))
  assert.deepEqual(ran.published, ['connections'])
  assert.equal(log.commits, 1)
})
