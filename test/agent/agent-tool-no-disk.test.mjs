// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { cruise } from 'dependency-cruiser'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { validateAgentToolArgs } from '../../src/interfaces/agent/agent-tool-preflight.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

test('vision_bench production module does not import the workspace store or host executor', async () => {
  const result = await cruise(['src/interfaces/agent/vision-bench-tool.mjs'], {
    combinedDependencies: true,
    ruleSet: { forbidden: [] },
  })
  const sources = result.output.modules.map((/** @type {{ source: string }} */ mod) => mod.source)
  assert.equal(
    sources.some((item) => item.includes('infrastructure/store')),
    false,
    sources.filter((item) => item.includes('store')).join('\n'),
  )
  assert.equal(sources.some((item) => item.includes('host-command-service')), false)
})

test('alarmId-only preflight defers uniqueness to the Host', () => {
  assert.equal(validateAgentToolArgs({ action: 'alarm', alarmId: 'shared' }, { pack: null }), null)
  const miss = validateAgentToolArgs({ action: 'alarm' }, { pack: null })
  assert.ok(miss)
  assert.deepEqual(miss.missingFields, ['connectionId'])
})

test('Host alarmId without a unique connection returns the preflight error shape', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-alarm-unique-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { sim: true }), connection('c2', 'tcp', '', { sim: true })],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [],
      alarmState: { shared: { condition: 'active', pointId: 'px' } },
    },
  })
  const miss = await runVisionBench(home, { action: 'alarm', alarmId: 'shared' }, cwd, {
    source: 'user',
    sessionId: 's1',
  })
  assert.equal(miss.ok, false)
  assert.equal(miss.errorCode, 'TARGET_REQUIRED')
  assert.equal(miss.error, '缺少必要参数: connectionId')
  assert.deepEqual(miss.missingFields, ['connectionId'])
  assert.match(String(miss.hint || ''), /connectionId/)

  bench.save({
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { sim: true }), connection('c2', 'tcp', '', { sim: true })],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [],
      alarmState: { shared: { condition: 'active', pointId: 'px', connectionId: 'c1' } },
    },
  })
  const ok = await runVisionBench(
    home,
    { action: 'alarm', alarmId: 'shared', connectionId: 'c1' },
    cwd,
    { source: 'user', sessionId: 's1' },
  )
  assert.equal(ok.ok, true, ok.error)
  const unique = await runVisionBench(home, { action: 'alarm', alarmId: 'shared' }, cwd, {
    source: 'user',
    sessionId: 's1',
  })
  assert.equal(unique.ok, true, unique.error)
})

test('Host trendKey that cannot be resolved returns missingFields and hint', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-trend-unique-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { sim: true })],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
    },
  })
  const miss = await runVisionBench(home, { action: 'trend', trendKey: 'c1:d1:missing' }, cwd, {
    source: 'user',
    sessionId: 's1',
  })
  assert.equal(miss.ok, false)
  assert.equal(miss.errorCode, 'TARGET_MISMATCH')
  assert.deepEqual(miss.missingFields, [])
  assert.match(String(miss.hint || ''), /connectionId/)
})
