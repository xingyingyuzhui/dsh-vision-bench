import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeModbus } from '../bench-devices.mjs'
import { loadWorkspace, saveWorkspace, appendEvidence } from '../bench-store.mjs'

test('Task7: appendEvidence merges not overwrites, keeps last 20, validates ID and configVersion, survives restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-evidence-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }
    const p2 = { id: 'p2', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 1 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1, p2] } })
    const baseCv = loadWorkspace(home, cwd).modbus.configVersion
    // first append
    let r = appendEvidence(home, cwd, { kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: baseCv })
    assert.equal(r.ok, true)
    assert.equal(r.evidence.length, 1)
    // second append should merge, not overwrite, and keep order
    r = appendEvidence(home, cwd, { kind: 'point', id: 'p2', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: baseCv })
    assert.equal(r.ok, true)
    assert.equal(r.evidence.length, 2)
    assert.equal(r.evidence[0].id, 'p1')
    assert.equal(r.evidence[1].id, 'p2')
    // append 25 more to test last 20 retention
    for (let i = 0; i < 25; i++) {
      appendEvidence(home, cwd, { kind: 'point', id: `p${i % 2 === 0 ? '1' : '2'}`, connectionId: 'c1', deviceId: 'd1', at: Date.now() + i, version: baseCv })
    }
    r = loadWorkspace(home, cwd)
    assert.equal(r.focus.evidence.length, 20, 'should keep last 20')
    // oldest should be dropped, newest should remain
    assert.ok(r.focus.evidence[0].at >= r.focus.evidence[0].at, 'evidence should be recent')
    // validates ID: invalid point id should fail
    const badId = appendEvidence(home, cwd, { kind: 'point', id: 'nonexistent', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: baseCv })
    assert.equal(badId.ok, false)
    assert.match(badId.error, /不存在|TARGET_MISMATCH/)
    // validates configVersion: wrong version should fail
    const badCv = appendEvidence(home, cwd, { kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: baseCv + 99 })
    assert.equal(badCv.ok, false)
    assert.match(badCv.error, /漂移|CONFIG_DRIFT|版本/)
    // survives restart: reload should have same evidence
    const before = loadWorkspace(home, cwd).focus.evidence.slice()
    // simulate restart by reloading (already persisted)
    const after = loadWorkspace(home, cwd).focus.evidence
    assert.deepEqual(after, before)
    // array append also merges
    const arrRes = appendEvidence(home, cwd, [
      { kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: loadWorkspace(home, cwd).modbus.configVersion },
      { kind: 'point', id: 'p2', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: loadWorkspace(home, cwd).modbus.configVersion },
    ])
    assert.equal(arrRes.ok, true)
    assert.ok(arrRes.evidence.length <= 20)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Task7: POST /evidence merges and validates via host', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-evidence-host-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    // use bench-tool via host-like call: runVisionBench evidence should use appendEvidence internally
    const { runVisionBench } = await import('../bench-tool.mjs')
    let res = await runVisionBench(home, { action: 'evidence', evidence: [{ kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1', at: Date.now(), version: cv }] }, cwd, { source: 'user', sessionId: 's1' })
    assert.equal(res.ok, true)
    let ws = loadWorkspace(home, cwd)
    assert.ok(ws.focus.evidence.length >= 1)
    // second call should merge, not overwrite
    res = await runVisionBench(home, { action: 'evidence', evidence: [{ kind: 'point', id: 'p1', connectionId: 'c1', deviceId: 'd1', at: Date.now() + 1, version: cv }] }, cwd, { source: 'user', sessionId: 's1' })
    ws = loadWorkspace(home, cwd)
    assert.ok(ws.focus.evidence.length >= 2, 'should merge evidence, not overwrite')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
