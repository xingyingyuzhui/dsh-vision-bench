// @ts-check
import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { validateAgentToolArgs } from '../../src/interfaces/agent/agent-tool-preflight.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const toolPath = join(root, 'src/interfaces/agent/vision-bench-tool.mjs')

/**
 * Static import graph of one production module (relative specifiers only).
 * @param {string} file
 * @param {Set<string>} [seen]
 * @returns {string[]}
 */
function importGraph(file, seen = new Set()) {
  const abs = file.startsWith(root) ? file : join(root, file)
  if (seen.has(abs)) return []
  seen.add(abs)
  const src = readFileSync(abs, 'utf8')
  const specs = [...src.matchAll(/from\s+['"](\.[^'"]+)['"]/g)].map((m) => m[1])
  /** @type {string[]} */
  const out = []
  for (const spec of specs) {
    const resolved = join(dirname(abs), spec)
    const rel = resolved.startsWith(root) ? resolved.slice(root.length + 1) : resolved
    out.push(rel)
    out.push(...importGraph(resolved, seen))
  }
  return out
}

test('vision_bench production module does not import the workspace store or host executor', () => {
  const src = readFileSync(toolPath, 'utf8')
  assert.doesNotMatch(src, /executeHostCommand/)
  assert.doesNotMatch(src, /loadWorkspace/)
  const graph = importGraph(toolPath)
  assert.equal(
    graph.some((item) => item.includes('infrastructure/store')),
    false,
    `import graph must not include infrastructure/store:\n${graph.filter((item) => item.includes('store')).join('\n')}`,
  )
})

test('alarmId-only preflight is schema-level and does not prove uniqueness', () => {
  const miss = validateAgentToolArgs({ action: 'alarm', alarmId: 'shared' }, { pack: null })
  assert.ok(miss)
  assert.equal(miss.errorCode, 'TARGET_REQUIRED')
  assert.deepEqual(miss.missingFields, ['connectionId'])
  assert.match(String(miss.hint || ''), /connectionId/)
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
