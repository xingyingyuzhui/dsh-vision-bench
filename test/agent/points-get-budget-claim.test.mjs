// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { AGENT_TEXT_CAPS } from '../../src/application/commands/agent-result-caps.mjs'
import { projectAgentResult, utf8ByteLength } from '../../src/application/commands/agent-result-projection.mjs'
import { visionBenchTool } from '../../src/interfaces/agent/vision-bench-tool.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { runtimeFingerprint } from './points-value-isolation-helpers.mjs'

/**
 * @param {number} n
 * @param {{ fat?: boolean }} [opts]
 */
function fatPoints(n, opts = {}) {
  // 40 CJK name + 6 CJK unit — matches review reproduction that overflows listBytes with valueStatus.
  const name =
    opts.fat === false
      ? 'p'
      : '测点名称用于撑满代理文本预算截断边界的汉字填充甲乙丙丁戊己庚辛壬癸子丑寅卯辰巳午未申酉戌亥超预算再补十字保证工具链也溢出'
  const unit = opts.fat === false ? '' : '工程单位六字'
  return Array.from({ length: n }, (_, i) => ({
    id: `p${i}`,
    connectionId: 'c1',
    deviceId: 'd1',
    name,
    area: 'holdingRegister',
    function: 3,
    address: i,
    unit,
    scale: 1,
    offset: 0,
    monitorEnabled: true,
    alarmEnabled: false,
    valueStatus: 'missing',
    raw: null,
    value: null,
    ok: false,
    at: 0,
    connId: 'c1',
    writable: true,
    trendEnabled: true,
    alarmMin: null,
    alarmMax: null,
    alarmDeadband: null,
  }))
}

test('points get projection: returned === points.length; omittedIds not missingIds', () => {
  const points = fatPoints(32)
  const ids = points.map((p) => p.id)
  const raw = {
    ok: true,
    action: 'points',
    configVersion: 1,
    points,
    requested: 32,
    returned: 32,
    missingIds: [],
    partial: false,
  }
  const projected = projectAgentResult({ action: 'points', op: 'get', ids }, raw)
  assert.ok(utf8ByteLength(projected) <= AGENT_TEXT_CAPS.listBytes)
  assert.equal(projected.truncated, true)
  assert.equal(projected.returned, projected.points.length)
  assert.ok(projected.points.length < 32)
  assert.ok(Array.isArray(projected.omittedIds))
  assert.equal(projected.omittedIds.length, 32 - projected.points.length)
  assert.deepEqual(projected.missingIds, [])
  assert.equal(projected.partial, false)
  assert.equal(projected.requested, 32)
  for (const row of projected.points) {
    assert.equal(row.valueStatus, 'missing')
  }
  const kept = new Set(projected.points.map((/** @type {any} */ p) => p.id))
  for (const id of projected.omittedIds) {
    assert.equal(kept.has(id), false)
  }
})

test('Agent tool get overrun: honest returned + omittedIds via Host projection', async (t) => {
  // Point name/unit are capped at 40/12 on save, so a live workspace may sit just
  // under listBytes. Drive the real tool→Host→project path with a fat Host payload
  // that matches production row shape (including valueStatus).
  const points = fatPoints(32)
  const ids = points.map((p) => p.id)
  unregisterVisionHost()
  let hostCalls = 0
  const stop = registerVisionHost({
    dispatch(cmd) {
      hostCalls += 1
      assert.equal(cmd.action, 'points')
      return {
        ok: true,
        action: 'points',
        commandId: cmd.commandId,
        configVersion: 2,
        points,
        requested: 32,
        returned: 32,
        missingIds: [],
        partial: false,
      }
    },
  })
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool('/tmp')
  const ran = await tool.execute(
    { action: 'points', op: 'get', ids, commandId: 'cmd-get-budget' },
    { agent: { session: { header: { cwd: '/tmp', id: 's1' } } } },
  )
  assert.equal(ran.ok, true, ran.error)
  assert.equal(ran.commandId, 'cmd-get-budget')
  assert.equal(hostCalls, 1)
  assert.ok(utf8ByteLength(ran) <= AGENT_TEXT_CAPS.listBytes)
  assert.equal(ran.truncated, true)
  assert.equal(ran.returned, ran.points.length)
  assert.ok(ran.points.length < 32)
  assert.ok(Array.isArray(ran.omittedIds) && ran.omittedIds.length === 32 - ran.points.length)
  assert.deepEqual(ran.missingIds, [])
  assert.equal(ran.partial, false)
  assert.ok(ran.points.every((/** @type {any} */ p) => p.valueStatus === 'missing'))
})

test('points list on legacy workspace does not persist claim', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-list-noclaim-' })
  const { home, cwd } = bench
  const points = fatPoints(8, { fat: false }).map(
    ({ valueStatus: _vs, raw: _r, value: _v, ok: _ok, at: _at, ...p }) => p,
  )
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 5,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points,
      values: [],
    },
  })
  const before = runtimeFingerprint(loadWorkspace(home, cwd))
  assert.equal(before.privateClaimSessionId, '')
  assert.equal(before.flatPointCount, 8)

  const listed = await runVisionBench(
    home,
    { action: 'points', op: 'list' },
    cwd,
    { source: 'agent', sessionId: 'opener' },
  )
  assert.equal(listed.ok, true, listed.error)
  assert.equal(listed.points.length, 8)

  const after = runtimeFingerprint(loadWorkspace(home, cwd))
  assert.deepEqual(after, before, 'list must not persist claim or move topology')
  assert.equal(after.privateClaimSessionId, '')
  assert.equal(after.flatPointCount, 8)
  assert.deepEqual(after.sessionConfigKeys, [])
})
