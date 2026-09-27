// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace } from '../../bench-store.mjs'
import { visionBenchTool } from '../../bench-tool.mjs'
import { executeVisionCommand } from '../../src/application/commands/vision-command-service.mjs'
import { registerVisionHost, unregisterVisionHost } from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

/**
 * @param {import('node:test').TestContext} t
 * @param {string} home
 * @param {string} cwd
 * @param {string} sessionId
 */
function agentExec(t, home, cwd, sessionId) {
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  t.after(() => {
    stop()
    unregisterVisionHost()
  })
  const tool = visionBenchTool(home)
  return (/** @type {any} */ args) =>
    tool.execute(args, { agent: { session: { header: { cwd, id: sessionId } } } })
}

test('vision_bench schema publishes cursor and view and rejects unknown fields', () => {
  const tool = visionBenchTool('/tmp/unused')
  const props = tool.parameters.properties
  assert.equal(tool.parameters.additionalProperties, false)
  assert.equal(props.cursor.type, 'string')
  assert.deepEqual(props.view.enum, ['full', 'summary'])
  assert.match(tool.description, /默认 limit 20、最大 50/)
  assert.match(tool.description, /timeline\.list/)
  assert.match(tool.description, /logHiddenCount/)
  assert.match(tool.description, /focus\.get 与 timeline\.list 是只读/)
  assert.equal('notAField' in props, false)
})

test('Agent preflight and Host reject cursor/view outside their queries', async () => {
  const home = '/tmp/unused-query-fields'
  const tool = visionBenchTool(home)
  const exec = { agent: { session: { header: { cwd: '/tmp/proj', id: 's1' } } } }
  const frames = await tool.execute({ action: 'frames', connectionId: 'c1', cursor: 'abc' }, exec)
  assert.equal(frames.ok, false)
  assert.equal(frames.errorCode, 'INVALID_FIELD')
  assert.equal(frames.details.field, 'cursor')
  assert.deepEqual(frames.details.supportedBy, ['points op=list', 'timeline.list'])
  assert.match(frames.hint, /offset/)
  assert.ok(frames.commandId)

  const alarmView = await tool.execute({ action: 'alarm', connectionId: 'c1', view: 'summary' }, exec)
  assert.equal(alarmView.ok, false)
  assert.equal(alarmView.errorCode, 'INVALID_FIELD')
  assert.equal(alarmView.details.field, 'view')

  const getView = await tool.execute({ action: 'points', op: 'get', ids: ['p1'], view: 'summary' }, exec)
  assert.equal(getView.ok, false)
  assert.equal(getView.errorCode, 'INVALID_FIELD')
  assert.equal(getView.details.field, 'view')
  assert.equal(getView.details.action, 'points')

  const host = await executeVisionCommand({
    home,
    cwd: '/tmp/proj',
    sessionId: 's1',
    source: 'agent',
    action: 'frames',
    payload: { action: 'frames', connectionId: 'c1', cursor: 'abc' },
  })
  assert.equal(host.ok, false)
  assert.equal(host.errorCode, 'INVALID_FIELD')
  assert.equal(host.details.field, 'cursor')
  assert.ok(host.commandId)
})

test('Agent tool execute pages 45 summary points and a timeline longer than 20', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-query-schema-' })
  const { home, cwd } = bench
  const points = Array.from({ length: 45 }, (_, i) => ({
    id: `p${String(i).padStart(2, '0')}`,
    name: `N${i}`,
    connectionId: 'c1',
    deviceId: 'd1',
    function: 3,
    address: i,
    type: 'uint16',
  }))
  const timeline = Array.from({ length: 25 }, (_, i) => ({
    id: `e${String(24 - i).padStart(2, '0')}`,
    at: 24 - i,
    kind: 'read',
    source: 'agent',
    sessionId: 'session-a',
    taskId: '',
    ok: true,
    summary: `event ${i}`,
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 4,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c1', 'tcp', '', { sim: true })],
          devices: [{ id: 'd1', connectionId: 'c1', name: 'D', unitId: 1 }],
          points,
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
    timeline,
  })
  const run = agentExec(t, home, cwd, 'session-a')

  const ids = []
  let cursor = ''
  for (let page = 0; page < 3; page += 1) {
    const result = await run({
      action: 'points',
      op: 'list',
      view: 'summary',
      limit: 20,
      ...(cursor ? { cursor } : {}),
    })
    assert.equal(result.ok, true, result.error)
    assert.equal(result.view, 'summary')
    assert.equal(result.total, 45)
    assert.equal(result.returned, result.points.length)
    assert.equal('raw' in result.points[0], false)
    ids.push(...result.points.map((/** @type {{ id: string }} */ p) => p.id))
    cursor = result.nextCursor || ''
    if (page < 2) assert.ok(result.nextCursor)
  }
  assert.equal(cursor, '')
  assert.equal(new Set(ids).size, 45)

  const drifted = await run({
    action: 'points',
    op: 'list',
    view: 'summary',
    cursor: ids.length ? '%%%' : '',
  })
  assert.equal(drifted.ok, false)
  assert.equal(drifted.errorCode, 'CURSOR_EXPIRED')

  const first = await run({ action: 'timeline.list' })
  assert.equal(first.ok, true, first.error)
  assert.equal(first.total, 25)
  assert.equal(first.returned, 20)
  assert.ok(first.nextCursor)
  const second = await run({ action: 'timeline.list', cursor: first.nextCursor })
  assert.equal(second.ok, true, second.error)
  assert.equal(second.returned, 5)
  assert.equal(second.nextCursor, null)
  const seen = [...first.events, ...second.events].map((/** @type {{ id: string }} */ e) => e.id)
  assert.equal(new Set(seen).size, 25)
})
