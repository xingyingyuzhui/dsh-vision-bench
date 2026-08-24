import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { runVisionBench } from '../bench-tool.mjs'
import { ERROR_CODES, listFrames, requestFocus, resolvePendingWrite } from '../bench-modbus.mjs'
import { buildAgentRef, agentRefToText, getFocusState, setFocusState } from '../bench-shared.mjs'
import { loadWorkspace, saveBindings, saveWorkspace } from '../bench-store.mjs'

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

test('Agent live ops need deviceId on multi-device connections; pending write binds unit/config; reject safe; unit drift voids (§16.5-30/31/32/33)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-agent-n4-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T1', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }, { id: 'd2', connectionId: 'c1', name: 'D2', unitId: 2 }], points: [p1] } })
    // 30) ambiguous device -> TARGET_REQUIRED for live read/write
    const readMissing = await runVisionBench(home, { action: 'read', connectionId: 'c1', function: 3, address: 0 }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(readMissing.errorCode, ERROR_CODES.TARGET_REQUIRED)
    const writeMissing = await runVisionBench(home, { action: 'write', connectionId: 'c1', function: 3, address: 0, values: [1] }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(writeMissing.errorCode, ERROR_CODES.TARGET_REQUIRED)
    // 31) confirmation card binds connection/device/points/configVersion/unit
    const first = await runVisionBench(home, { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(first.needsConfirm, true)
    assert.equal(first.request.deviceId, 'd1')
    assert.deepEqual(first.request.pointIds, ['p1'])
    assert.equal(first.request.endpoint.configVersion, loadWorkspace(home, cwd).modbus.configVersion)
    assert.equal(first.request.endpoint.unitId, 1)
    // 33) rejection leaves the device untouched
    assert.equal((await resolvePendingWrite(home, cwd, first.requestId, false)).rejected, true)
    assert.equal((loadWorkspace(home, cwd).modbus.values || []).length, 0)
    // 32) switching the Unit ID before approval voids the old request
    const second = await runVisionBench(home, { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [6] }, cwd, { source: 'agent', sessionId: 's2' })
    saveWorkspace(home, cwd, { modbus: { devices: loadWorkspace(home, cwd).modbus.devices.map((d) => d.id === 'd1' ? { ...d, unitId: 3 } : d) } })
    const driftedUnit = await resolvePendingWrite(home, cwd, second.requestId, true)
    assert.equal(driftedUnit.ok, false)
    assert.equal(driftedUnit.errorCode, ERROR_CODES.ENDPOINT_DRIFT)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('approved write reports protocol result and readback consistency (§16.5-34)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-agent-readback-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const { writeFile, chmod } = await import('node:fs/promises')
    const { execFileSync } = await import('node:child_process')
    let pythonBin = ''
    try { pythonBin = execFileSync('python3', ['-c', 'import sys; print(sys.executable)'], { encoding: 'utf8' }).trim() } catch { }
    if (!pythonBin) return
    const fake = join(home, 'fake_modbus.py')
    await writeFile(fake, [
      'import json, sys',
      "f = {'request': 'SEND 01 03', 'response': 'RECV 01 03 02 0007', 'trace': ['SEND 01 03']}",
      "print(json.dumps({'status':'ok','details':{'frames':f,'raw':[7],'value':7} if '--values' not in sys.argv[1:] else {'frames':f}}, ensure_ascii=False), flush=True)",
    ].join('\n'))
    const runner = join(home, 'fake_python.sh')
    await writeFile(runner, '#!/bin/sh\nexec "' + pythonBin + '" "' + fake + '" "$@"\n')
    if (process.platform !== 'win32') await chmod(runner, 0o755)
    saveBindings(home, { python: runner, uv4: '', openocd: '' })
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502, slave: 1 } }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }], points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T1', area: 'holdingRegister', function: 3, address: 0 }] } })
    // consistent: written 7, device answers 7 -> summary carries protocol + 回读一致
    const okReq = await runVisionBench(home, { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [7] }, cwd, { source: 'agent', sessionId: 's1' })
    const okRun = await resolvePendingWrite(home, cwd, okReq.requestId, true)
    assert.equal(okRun.ok, true)
    assert.match(okRun.summary, /回读一致/)
    assert.deepEqual(okRun.readback, [7])
    assert.ok(okRun.frames && okRun.frames.request)
    // mismatch: written 5, device still answers 7
    const badReq = await runVisionBench(home, { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] }, cwd, { source: 'agent', sessionId: 's1' })
    const badRun = await resolvePendingWrite(home, cwd, badReq.requestId, true)
    assert.equal(badRun.ok, false)
    assert.equal(badRun.errorCode, ERROR_CODES.WRITE_READBACK_MISMATCH)
    assert.match(badRun.summary || badRun.error, /回读不一致/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('config draft cannot apply after base config version drift (§16.5-35)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-agent-draft-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true } }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }], points: [] } })
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const draftArgs = { action: 'draft', op: 'create', baseConfigVersion: cv, patch: [{ op: 'replace', path: '/connections/0/name', value: 'C1-renamed' }] }
    const created = await runVisionBench(home, draftArgs, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(created.ok, true)
    // adding a point bumps configVersion -> the stale draft must refuse to apply
    saveWorkspace(home, cwd, { modbus: { points: [{ id: 'px', connectionId: 'c1', deviceId: 'd1', name: 'PX', area: 'holdingRegister', function: 3, address: 9 }] } })
    const drifted = await runVisionBench(home, { action: 'draftApply', draftId: created.draft.id }, cwd, { source: 'user' })
    assert.equal(drifted.ok, false)
    assert.equal(drifted.errorCode, 'CONFIG_DRIFT')
    // positive control: a fresh draft against the new baseline applies cleanly
    const cv2 = loadWorkspace(home, cwd).modbus.configVersion
    const fresh = await runVisionBench(home, { ...draftArgs, baseConfigVersion: cv2 }, cwd, { source: 'user' })
    const applied = fresh.ok ? await runVisionBench(home, { action: 'draftApply', draftId: fresh.draft.id }, cwd, { source: 'user' }) : fresh
    assert.equal(applied.ok, true)
    assert.equal(applied.nextVersion, cv2 + 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
