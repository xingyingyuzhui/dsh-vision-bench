// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { projectAgentResult } from '../../src/application/commands/agent-result-projection.mjs'

test('projectAlarm list keeps ACK fields; comm pointId stays empty', () => {
  const raw = {
    ok: true,
    action: 'alarm',
    alarms: {
      'p-1': {
        group: 'process',
        pointId: 'p-1',
        status: 'acked',
        condition: 'active',
        acknowledged: true,
        ackedAt: 100,
        ackedBy: 'user',
        count: 3,
        occurredAt: 50,
      },
      'comm:c1': {
        group: 'comm',
        connectionId: 'c1',
        status: 'active',
        condition: 'active',
        acknowledged: false,
        count: 1,
      },
    },
  }
  const projected = projectAgentResult({ action: 'alarm' }, raw)
  assert.equal(projected.alarms['p-1'].acknowledged, true)
  assert.equal(projected.alarms['p-1'].ackedAt, 100)
  assert.equal(projected.alarms['p-1'].ackedBy, 'user')
  assert.equal(projected.alarms['p-1'].count, 3)
  assert.equal(projected.alarms['p-1'].pointId, 'p-1')
  assert.equal(projected.alarms['comm:c1'].pointId, '')
  assert.equal(projected.alarms['comm:c1'].id, 'comm:c1')
  assert.equal('durationMs' in projected.alarms['p-1'], false)
})

test('projectAlarm single lookup includes detail audit fields', () => {
  const raw = {
    ok: true,
    action: 'alarm',
    alarms: {
      'p-1': {
        group: 'process',
        pointId: 'p-1',
        status: 'acked',
        acknowledged: true,
        ackedAt: 9,
        ackedBy: 'agent',
        count: 2,
        durationMs: 40,
        suggestedAt: 8,
        suggestedBy: 'system',
        taskId: 't1',
        suppressUntil: 99,
        pendingSince: 7,
      },
    },
  }
  const projected = projectAgentResult({ action: 'alarm', alarmId: 'p-1' }, raw)
  assert.equal(projected.alarms['p-1'].durationMs, 40)
  assert.equal(projected.alarms['p-1'].taskId, 't1')
  assert.equal(projected.alarms['p-1'].suppressUntil, 99)
  assert.equal(projected.alarms['p-1'].pendingSince, 7)
  assert.equal(projected.returned, 1)
})
