// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { saveWorkspace, loadWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

test('focus.get returns only this session focus; foreign is inactive', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-focus-get-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c-a', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-a', connectionId: 'c-a', name: 'A', unitId: 1 }],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
        'session-b': {
          connections: [connection('c-b', 'tcp', '', { sim: true })],
          devices: [{ id: 'd-b', connectionId: 'c-b', name: 'B', unitId: 1 }],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
    focus: {
      sessionId: 'session-b',
      request: {
        kind: 'point',
        connectionId: 'c-b',
        deviceId: 'd-b',
        pointId: 'secret',
        at: 9,
        by: 'b',
      },
      prev: null,
      tempWatchIds: ['x'],
      badgeOnly: true,
      evidence: [{ id: 'ev1' }],
    },
  })
  const before = JSON.stringify(loadWorkspace(home, cwd).modbus.sessionConfigs)
  const a = await runVisionBench(home, { action: 'focus.get' }, cwd, {
    source: 'agent',
    sessionId: 'session-a',
  })
  assert.equal(a.ok, true, a.error)
  assert.equal(a.active, false)
  assert.equal(a.request, null)
  assert.equal(a.badgeOnly, false)

  saveWorkspace(home, cwd, {
    focus: {
      sessionId: 'session-a',
      request: {
        kind: 'point',
        connectionId: 'c-a',
        deviceId: 'd-a',
        pointId: 'p-a',
        frameId: '',
        trendKey: '',
        alarmId: '',
        visualizationId: '',
        at: 11,
        by: 'a',
      },
      prev: { kind: 'x' },
      tempWatchIds: ['keep-private'],
      badgeOnly: false,
      evidence: [{ id: 'nope' }],
    },
  })
  const owned = await runVisionBench(home, { action: 'focus.get' }, cwd, {
    source: 'agent',
    sessionId: 'session-a',
  })
  assert.equal(owned.ok, true, owned.error)
  assert.equal(owned.active, true)
  assert.equal(owned.request?.pointId, 'p-a')
  assert.equal(owned.request?.connectionId, 'c-a')
  assert.equal('prev' in owned, false)
  assert.equal('tempWatchIds' in owned, false)
  assert.equal('evidence' in owned, false)
  assert.equal(JSON.stringify(loadWorkspace(home, cwd).modbus.sessionConfigs), before)
})

test('timeline.list filters by session; cursor expiry; no disk claim migrate', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-tl-list-' })
  const { home, cwd } = bench
  const events = [
    { id: 'e3', at: 30, kind: 'focus', source: 'user', sessionId: 'session-a', taskId: '', ok: true, summary: 'a3' },
    { id: 'e2', at: 20, kind: 'alarm', source: 'system', sessionId: '', taskId: '', ok: false, summary: 'legacy global' },
    { id: 'e1', at: 10, kind: 'build', source: 'user', sessionId: 'session-b', taskId: 't', ok: true, summary: 'b only' },
    { id: 'e0', at: 5, kind: 'read', source: 'agent', sessionId: 'session-a', taskId: 't0', ok: true, summary: 'a0' },
  ]
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 2,
      share: { enabled: false, connections: false, points: false },
      privateClaimSessionId: 'session-a',
      connections: [],
      devices: [],
      points: [],
      sessionConfigs: {
        'session-a': {
          connections: [connection('c-a', 'tcp', '', { sim: true })],
          devices: [],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
        'session-b': {
          connections: [connection('c-b', 'tcp', '', { sim: true })],
          devices: [],
          points: [],
          visualization: { schemaVersion: 2, components: [] },
        },
      },
    },
    timeline: events,
  })
  const claimBefore = loadWorkspace(home, cwd).modbus.privateClaimSessionId
  const page1 = await runVisionBench(home, { action: 'timeline.list', limit: 1 }, cwd, {
    source: 'agent',
    sessionId: 'session-a',
  })
  assert.equal(page1.ok, true, page1.error)
  assert.equal(page1.total, 2)
  assert.equal(page1.returned, 1)
  assert.equal(page1.events[0].id, 'e3')
  assert.equal(page1.events[0].summary, 'a3')
  assert.equal(page1.nextCursor, 'e3')

  const page2 = await runVisionBench(
    home,
    { action: 'timeline.list', limit: 1, cursor: page1.nextCursor },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(page2.ok, true, page2.error)
  assert.equal(page2.events[0].id, 'e0')
  assert.equal(page2.nextCursor, null)

  const expired = await runVisionBench(
    home,
    { action: 'timeline.list', cursor: 'missing-id' },
    cwd,
    { source: 'agent', sessionId: 'session-a' },
  )
  assert.equal(expired.ok, false)
  assert.equal(expired.errorCode, 'CURSOR_EXPIRED')

  const b = await runVisionBench(home, { action: 'timeline.list' }, cwd, {
    source: 'agent',
    sessionId: 'session-b',
  })
  assert.equal(b.ok, true, b.error)
  assert.equal(b.total, 1)
  assert.equal(b.events[0].id, 'e1')
  assert.equal(loadWorkspace(home, cwd).modbus.privateClaimSessionId, claimBefore)
})
