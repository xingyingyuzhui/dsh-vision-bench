import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, listFrames, requestFocus } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import { saveSessionModbusPatch } from '../../src/application/modbus/workspace-session-view.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { agentDevice, agentHrPoint, agentRtu } from './ui-fixtures.mjs'

test('Agent frames requires explicit connectionId (TARGET_REQUIRED) and lists with stable id', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-agent-frames-' })
  const { home, cwd } = bench
  const c1 = agentRtu('c1', 'COM3', { name: 'C1' })
  const c2 = agentRtu('c2', 'COM4', { name: 'C2' })
  bench.save({
    modbus: {
      version: 3,
      connections: [c1, c2],
      devices: [agentDevice('d1', 'c1'), agentDevice('d2', 'c2')],
      points: [],
    },
  })
  const missing = await runVisionBench(home, { action: 'frames' }, cwd, { source: 'agent', sessionId: 's1' })
  assert.equal(missing.ok, false)
  assert.equal(missing.errorCode, ERROR_CODES.TARGET_REQUIRED)
  const ok = await runVisionBench(home, { action: 'frames', connectionId: 'c1', limit: 10 }, cwd, {
    source: 'agent',
    sessionId: 's1',
  })
  assert.equal(ok.ok, true)
  assert.equal(ok.connectionId, 'c1')
  assert.equal(ok.configVersion, loadWorkspace(home, cwd).modbus.configVersion)
  const disabledC1 = { ...c1, enabled: false }
  const disabledSaved = await saveSessionModbusPatch(home, cwd, 's1', {
    modbus: { connections: [disabledC1, c2] },
  })
  assert.equal(disabledSaved.ok, true, disabledSaved.error)
  const disabled = listFrames(home, cwd, { source: 'agent', sessionId: 's1', connectionId: 'c1' })
  assert.equal(disabled.ok, false)
  assert.equal(disabled.errorCode, ERROR_CODES.DEVICE_DISABLED)
})

test('Agent focus creates highlight with stable IDs, temp watch and badgeOnly', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-agent-focus-' })
  const { home, cwd } = bench
  const c1 = agentRtu('c1', 'COM3', { name: 'COM3' })
  const p1 = agentHrPoint('p1', 'c1', 'd1', 0, { name: 'T1' })
  const p2 = agentHrPoint('p2', 'c1', 'd1', 1, { name: 'T2' })
  bench.save({
    modbus: {
      version: 3,
      connections: [c1],
      devices: [agentDevice('d1', 'c1', 1, 'D1')],
      points: [p1, p2],
    },
  })
  const bad = await runVisionBench(home, { action: 'focus' }, cwd, { source: 'agent', sessionId: 's1' })
  assert.equal(bad.ok, false)
  assert.equal(bad.errorCode, ERROR_CODES.TARGET_REQUIRED)
  const expectedCv = loadWorkspace(home, cwd).modbus.configVersion
  const ok = await runVisionBench(
    home,
    {
      action: 'focus',
      connectionId: 'c1',
      deviceId: 'd1',
      pointId: 'p1',
      tempWatchIds: ['p1', 'p2'],
      badgeOnly: true,
      evidence: [{ kind: 'point', id: 'p1', connectionId: 'c1', at: Date.now(), version: expectedCv }],
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(ok.ok, true)
  assert.equal(ok.focus.connectionId, 'c1')
  assert.equal(ok.focus.pointId, 'p1')
  assert.equal(ok.focus.version, expectedCv)
  assert.equal(ok.badgeOnly, true)
  assert.deepEqual(ok.tempWatchIds, ['p1', 'p2'])
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.focus.request.pointId, 'p1')
  assert.equal(ws.focus.badgeOnly, true)
  assert.equal(ws.focus.tempWatchIds.length, 2)
  assert.equal(ws.focus.evidence.length, 1)
  const second = await runVisionBench(home, { action: 'focus', connectionId: 'c1', pointId: 'p2' }, cwd, {
    source: 'agent',
    sessionId: 's1',
  })
  assert.equal(second.ok, true)
  assert.equal(second.prev.pointId, 'p1')
  const frameMiss = await requestFocus(home, cwd, {
    source: 'agent',
    target: { connectionId: 'c1', frameId: 'nonexistent' },
  })
  assert.equal(frameMiss.ok, false)
  assert.equal(frameMiss.errorCode, ERROR_CODES.TARGET_MISMATCH)
})
