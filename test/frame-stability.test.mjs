import assert from 'node:assert/strict'
import { mkdtemp, mkdir, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeModbus } from '../bench-devices.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { modbusRead } from '../bench-modbus.mjs'
import { pushFramesLog, getFramesLog, clearFramesLog } from '../bench-shared.mjs'

test('Task6: frameId/transactionId stable, rich fields preserved, trimming and restart stable', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-frame-stab-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
    const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 7 }
    const p1 = { id: 'p1', connectionId: 'c1', deviceId: 'd1', area: 'holdingRegister', function: 3, address: 0 }
    saveWorkspace(home, cwd, { modbus: { version: 3, connections: [c1], devices: [d1], points: [p1] } })
    // do a read to generate a frame
    const res = await modbusRead(home, cwd, { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' })
    assert.equal(res.ok, true)
    assert.ok(Array.isArray(res.framesLog) && res.framesLog.length > 0, 'should have framesLog')
    const f = res.framesLog[0]
    // required fields
    for (const k of ['frameId', 'transactionId', 'connectionId', 'deviceId', 'taskId', 'source', 'direction', 'at', 'requestHex', 'responseHex', 'unitId', 'functionCode', 'durationMs', 'status', 'error']) {
      assert.ok(k in f, `frame should have ${k}, got ${JSON.stringify(f)}`)
    }
    assert.equal(f.connectionId, 'c1')
    assert.equal(f.deviceId, 'd1')
    assert.equal(f.unitId, 7)
    assert.equal(f.functionCode, 3)
    // trimming stable: push 600 frames, should keep newest 500 with stable ids
    const gen = (n, off = 0) => Array.from({ length: n }, (_, i) => ({
      frameId: `f-${off + i}`,
      transactionId: `t-${off + i}`,
      connectionId: 'c1',
      deviceId: 'd1',
      taskId: 't1',
      source: 'user',
      direction: i % 2 === 0 ? 'tx' : 'rx',
      at: Date.now() + off + i,
      t: Date.now() + off + i,
      label: `L${off + i}`,
      request: `REQ${off + i}`,
      response: `RESP${off + i}`,
      requestHex: `00${off + i}`,
      responseHex: `01${off + i}`,
      unitId: 7,
      functionCode: 3,
      durationMs: 10,
      status: 'ok',
      error: '',
    }))
    clearFramesLog(cwd)
    // also need to clear persisted framesByConnection
    saveWorkspace(home, cwd, { modbus: { framesByConnection: { c1: [] }, version: 3 } })
    pushFramesLog(cwd, 'c1', gen(300, 0))
    pushFramesLog(cwd, 'c1', gen(300, 300))
    const all = getFramesLog(cwd, 'c1')
    assert.equal(all.length, 500, 'should cap at 500')
    // oldest 100 should be dropped, newest 500 remain, ids should be stable
    assert.equal(all[0].frameId, 'f-100', 'trimming should keep newest 500 with original ids')
    assert.equal(all[all.length - 1].frameId, 'f-599')
    // persist and restart stable: save frames to workspace, reload, ids should remain
    const framesToPersist = all.slice(-10)
    saveWorkspace(home, cwd, { modbus: { framesByConnection: { c1: framesToPersist }, version: 3 } })
    const reloaded = loadWorkspace(home, cwd).modbus.framesByConnection['c1']
    assert.equal(reloaded.length, 10)
    for (let i = 0; i < 10; i++) {
      assert.equal(reloaded[i].frameId, framesToPersist[i].frameId, 'frameId should survive normalize and reload')
      assert.equal(reloaded[i].transactionId, framesToPersist[i].transactionId)
    }
    // normalize should preserve ids
    const norm = normalizeModbus({ version: 3, connections: [c1], devices: [d1], points: [p1], framesByConnection: { c1: [{ frameId: 'keep-id', transactionId: 'keep-tx', connectionId: 'c1', deviceId: 'd1', t: Date.now(), label: 'x', request: 'a', response: 'b' }] } })
    assert.equal(norm.framesByConnection['c1'][0].frameId, 'keep-id')
    assert.equal(norm.framesByConnection['c1'][0].transactionId, 'keep-tx')
  } finally {
    await rm(home, { recursive: true, force: true })
    clearFramesLog(cwd)
  }
})
