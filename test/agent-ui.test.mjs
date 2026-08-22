import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runVisionBench } from '../bench-tool.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { buildAgentRef, agentRefToText, getFocusState, setFocusState } from '../bench-shared.mjs'
import { ERROR_CODES, listFrames, requestFocus } from '../bench-modbus.mjs'

test('Agent frames requires explicit connectionId (TARGET_REQUIRED) and lists with stable id', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-agent-frames-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const d2 = { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1, c2], devices: [d1, d2], points: [] } })
    // Agent frames without connectionId should fail TARGET_REQUIRED when multiple conns
    const missing = await runVisionBench(home, { action: 'frames' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(missing.ok, false)
    assert.equal(missing.errorCode, ERROR_CODES.TARGET_REQUIRED)
    // With explicit connectionId ok, even when empty frames
    const ok = await runVisionBench(home, { action: 'frames', connectionId: 'c1', limit: 10 }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(ok.ok, true)
    assert.equal(ok.connectionId, 'c1')
    assert.equal(ok.configVersion, 3)
    // Device disabled -> DEVICE_DISABLED
    const disabledC1 = { ...c1, enabled: false }
    saveWorkspace(home, cwd, { modbus: { connections: [disabledC1, c2] } })
    const disabled = listFrames(home, cwd, { source: 'agent', connectionId: 'c1' })
    assert.equal(disabled.ok, false)
    assert.equal(disabled.errorCode, ERROR_CODES.DEVICE_DISABLED)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Agent focus creates highlight with stable IDs, temp watch and badgeOnly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-agent-focus-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'COM3', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T1', area: 'holdingRegister', function: 3, address: 0 }
    const p2 = { id: 'p2', connectionId: 'c1', deviceId: 'd1', name: 'T2', area: 'holdingRegister', function: 3, address: 1 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1, p2] } })
    // Missing target should be TARGET_REQUIRED
    const bad = await runVisionBench(home, { action: 'focus' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(bad.ok, false)
    assert.equal(bad.errorCode, ERROR_CODES.TARGET_REQUIRED)
    // Valid focus with explicit IDs
    const ok = await runVisionBench(home, { action: 'focus', connectionId: 'c1', deviceId: 'd1', pointId: 'p1', tempWatchIds: ['p1', 'p2'], badgeOnly: true, evidence: [{ kind: 'point', id: 'p1', connectionId: 'c1', at: Date.now(), version: 3 }] }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(ok.ok, true)
    assert.equal(ok.focus.connectionId, 'c1')
    assert.equal(ok.focus.pointId, 'p1')
    assert.equal(ok.focus.version, 3)
    assert.equal(ok.badgeOnly, true)
    assert.deepEqual(ok.tempWatchIds, ['p1', 'p2'])
    // Verify persisted focusState
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.focus.request.pointId, 'p1')
    assert.equal(ws.focus.badgeOnly, true)
    assert.equal(ws.focus.tempWatchIds.length, 2)
    assert.equal(ws.focus.evidence.length, 1)
    // Return to prev focus (no prev yet, but second focus should store prev)
    const second = await runVisionBench(home, { action: 'focus', connectionId: 'c1', pointId: 'p2' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(second.ok, true)
    assert.equal(second.prev.pointId, 'p1')
    // frames focus with frameId should require existing frame
    const frameMiss = requestFocus(home, cwd, { source: 'agent', target: { connectionId: 'c1', frameId: 'nonexistent' } })
    assert.equal(frameMiss.ok, false)
    assert.equal(frameMiss.errorCode, ERROR_CODES.POINT_NOT_FOUND)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('buildAgentRef produces stable ID+configVersion+timeRange and read/write error codes', async () => {
  const ref = buildAgentRef('point', { pointId: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T' }, { configVersion: 3, start: 1000, end: 2000 })
  assert.equal(ref.kind, 'point')
  assert.equal(ref.pointId, 'p1')
  assert.equal(ref.connectionId, 'c1')
  assert.equal(ref.configVersion, 3)
  assert.deepEqual(ref.timeRange, { start: 1000, end: 2000 })
  const text = agentRefToText(ref)
  assert.match(text, /point/)
  assert.match(text, /c1/)
  // device disabled write should return DEVICE_DISABLED
  const home = await mkdtemp(join(tmpdir(), 'dvb-agent-codes-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: false, conn: { mode: 'rtu', port: 'COM9', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1, enabled: true }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
    const { modbusWrite } = await import('../bench-modbus.mjs')
    const ran = await modbusWrite(home, cwd, { source: 'agent', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [1] })
    assert.equal(ran.ok, false)
    assert.equal(ran.errorCode, ERROR_CODES.DEVICE_DISABLED)
    // endpoint drift
    // create a pending write then change endpoint and try approve -> ENDPOINT_DRIFT
    const cSim = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM9', sim: true } }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [cSim], devices: [d1], points: [p1] } })
    const first = await runVisionBench(home, { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(first.needsConfirm, true)
    // drift endpoint: change port
    const cDrift = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM11', sim: true } }
    saveWorkspace(home, cwd, { modbus: { connections: [cDrift] } })
    const { resolvePendingWrite } = await import('../bench-modbus.mjs')
    const drifted = await resolvePendingWrite(home, cwd, first.requestId, true)
    assert.equal(drifted.ok, false)
    assert.equal(drifted.errorCode, ERROR_CODES.ENDPOINT_DRIFT)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
