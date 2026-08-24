import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeModbus } from '../bench-devices.mjs'
import { resolveTarget } from '../bench-targets.mjs'
import { runVisionBench } from '../bench-tool.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { ERROR_CODES } from '../bench-modbus.mjs'

const packFixture = () => normalizeModbus({
  version: 3,
  configVersion: 1,
  connections: [
    { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } },
    { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } },
  ],
  devices: [
    { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
    { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 },
    { id: 'd3', connectionId: 'c2', name: 'D3', unitId: 1 },
  ],
  points: [
    { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'P1', area: 'holdingRegister', function: 3, address: 0 },
    { id: 'p2', connectionId: 'c1', deviceId: 'd2', name: 'P2', area: 'holdingRegister', function: 3, address: 0 },
    { id: 'p3', connectionId: 'c2', deviceId: 'd3', name: 'P3', area: 'holdingRegister', function: 3, address: 5 },
  ],
  framesByConnection: {
    c1: [{ id: 'f1', frameId: 'f1', connectionId: 'c1', deviceId: 'd1', t: Date.now(), label: 'req', request: '00', response: '00' }],
    c2: [{ id: 'f2', frameId: 'f2', connectionId: 'c2', deviceId: 'd3', t: Date.now(), label: 'req', request: '00', response: '00' }],
  },
  alarmState: {
    a1: { id: 'a1', group: 'process', status: 'active', pointId: 'p1', connectionId: 'c1', deviceId: 'd1', value: 10, threshold: 5, firstAt: Date.now(), lastAt: Date.now(), count: 1 },
  },
  pollingByConnection: {},
  values: [],
  activeConnectionId: 'c1',
  activeDeviceId: 'd1',
})

test('resolveTarget validates connection/device/point/frame/alarm/trendKey and returns TARGET_REQUIRED vs TARGET_MISMATCH', () => {
  const pack = packFixture()
  // connection must exist
  let r = resolveTarget(pack, { connectionId: 'c9' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  // device belongs to connection
  r = resolveTarget(pack, { connectionId: 'c2', deviceId: 'd1' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  r = resolveTarget(pack, { connectionId: 'c1', deviceId: 'd1' })
  assert.equal(r.ok, true)
  // point belongs to connection+device
  r = resolveTarget(pack, { connectionId: 'c1', deviceId: 'd1', pointId: 'p2' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  r = resolveTarget(pack, { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' })
  assert.equal(r.ok, true)
  // missing deviceId when pointId present is inferred from point (allowed)
  r = resolveTarget(pack, { connectionId: 'c1', pointId: 'p1' })
  assert.equal(r.ok, true)
  // missing connectionId when pointId present -> TARGET_REQUIRED
  r = resolveTarget(pack, { pointId: 'p1' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_REQUIRED')
  // frame belongs to connection
  r = resolveTarget(pack, { connectionId: 'c1', frameId: 'f2' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  r = resolveTarget(pack, { connectionId: 'c1', frameId: 'f1' })
  assert.equal(r.ok, true)
  // alarm reference consistent
  r = resolveTarget(pack, { connectionId: 'c2', alarmId: 'a1' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  r = resolveTarget(pack, { connectionId: 'c1', deviceId: 'd1', alarmId: 'a1' })
  assert.equal(r.ok, true)
  // trendKey three IDs consistent
  r = resolveTarget(pack, { trendKey: 'c1:d1:p1' })
  assert.equal(r.ok, true)
  r = resolveTarget(pack, { trendKey: 'c1:d2:p1' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  r = resolveTarget(pack, { connectionId: 'c1', trendKey: 'c2:d3:p3' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_MISMATCH')
  // missing ID -> TARGET_REQUIRED
  r = resolveTarget(pack, { connectionId: 'c1', deviceId: 'd1', pointId: '' })
  // empty pointId but still device/connection valid -> still ok if no point required? Actually empty point not validated; but empty target with only connection should be ok
  assert.equal(r.ok, true)
  r = resolveTarget(pack, { })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_REQUIRED')
  r = resolveTarget(pack, { connectionId: '', deviceId: 'd1' })
  assert.equal(r.ok, false)
  assert.equal(r.errorCode, 'TARGET_REQUIRED')
})

test('resolveTarget is reused by read/write/frames/focus/trend/alarm/evidence (TARGET_REQUIRED/MISMATCH)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-target-int-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const pack = packFixture()
    // add trend-friendly points for alarm/evidence
    saveWorkspace(home, cwd, { modbus: pack })
    // read: missing deviceId on multi-device conn -> TARGET_REQUIRED
    let res = await runVisionBench(home, { action: 'read', connectionId: 'c1', function: 3, address: 0 }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.errorCode, ERROR_CODES.TARGET_REQUIRED)
    // read: point mismatch
    res = await runVisionBench(home, { action: 'read', connectionId: 'c2', deviceId: 'd3', pointId: 'p1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.errorCode, ERROR_CODES.TARGET_MISMATCH)
    // frames: frame belongs check
    res = await runVisionBench(home, { action: 'frames', connectionId: 'c1', frameId: 'f2' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.errorCode, ERROR_CODES.TARGET_MISMATCH)
    // focus: alarm mismatch
    res = await runVisionBench(home, { action: 'focus', connectionId: 'c2', alarmId: 'a1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.errorCode, ERROR_CODES.TARGET_MISMATCH)
    // trend: trendKey mismatch
    res = await runVisionBench(home, { action: 'trend', trendKey: 'c1:d2:p1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.errorCode, 'TARGET_MISMATCH')
    // alarm: alarmId valid
    res = await runVisionBench(home, { action: 'alarm', connectionId: 'c1', alarmId: 'a1' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
    // evidence: with valid point should ok, with mismatched should fail
    res = await runVisionBench(home, { action: 'evidence', evidence: [{ kind: 'point', id: 'p1', connectionId: 'c2' }] }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.errorCode, 'TARGET_MISMATCH')
    res = await runVisionBench(home, { action: 'evidence', evidence: [{ kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1' }] }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(res.ok, true)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
