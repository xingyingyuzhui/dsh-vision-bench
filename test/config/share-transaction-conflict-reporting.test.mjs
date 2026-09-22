import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'
import { rawMutationHarness } from '../helpers/raw-mutation-repo.mjs'
import { RAW_CWD, RAW_HOME, privateTwinD1, sharedTwinD1 } from '../helpers/share-raw-fixtures.mjs'

/**
 * share.update conflict reporting through the REAL mutation transaction
 * (review7 R2): errors must carry errorCode / conflicts / deviceId / connection
 * ids, and layer/sessionId must describe the layer the candidate would be saved
 * into — publish lands in the shared layer, revoke in this session's private
 * layer — through mutateConfig wrapping and the Agent projection alike.
 */

test('R1-9 CONFLICT 经 mutateConfig 包装与 Agent projection 后字段完整', async () => {
  const fixture = privateTwinD1('s1')
  const { service } = rawMutationHarness(fixture)
  const ran = await service.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 5,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(ran.ok, false, JSON.stringify(ran))
  const projected = projectAgentResult({ action: 'config' }, ran)
  assert.equal(projected.ok, false)
  assert.equal(projected.errorCode, 'CONFLICT')
  assert.equal(projected.conflicts?.[0]?.deviceId, 'd1')
  assert.deepEqual(projected.conflicts?.[0]?.connectionIds, ['c1', 'c2'])
  assert.ok(projected.error, 'error message must survive the projection')
})

test('R2-6 share 发布/撤销错误分别报告 shared 与 private 目标层', async () => {
  // Publish copies the raw private slice into the SHARED candidate layer.
  const pubFixture = privateTwinD1('s1')
  const { service: pubService } = rawMutationHarness(pubFixture)
  const pub = await pubService.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 5,
    operation: 'share.update',
    value: { enabled: true, connections: true },
  })
  assert.equal(pub.ok, false, JSON.stringify(pub))
  assert.deepEqual(pub.conflicts?.[0], {
    layer: 'shared',
    sessionId: '',
    deviceId: 'd1',
    connectionIds: ['c1', 'c2'],
  })

  // Revoke copies the raw shared slice into THIS session's private layer.
  const revFixture = sharedTwinD1()
  const { service: revService } = rawMutationHarness(revFixture)
  const rev = await revService.mutateConfig({
    home: RAW_HOME,
    cwd: RAW_CWD,
    sessionId: 's1',
    expectedConfigVersion: 7,
    operation: 'share.update',
    value: { enabled: true, connections: false, confirmed: true },
  })
  assert.equal(rev.ok, false, JSON.stringify(rev))
  assert.deepEqual(rev.conflicts?.[0], {
    layer: 'private',
    sessionId: 's1',
    deviceId: 'd1',
    connectionIds: ['c1', 'c2'],
  })
})
