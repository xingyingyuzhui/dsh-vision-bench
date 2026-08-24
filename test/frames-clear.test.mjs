// Task0 / 0.18.2 regression: frame clear must persist (per-connection and all),
// be idempotent for empty/unknown connections, never touch other config or
// bump configVersion, and survive reload.
import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { saveWorkspace, loadWorkspace } from '../bench-store.mjs'

const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', baudrate: 9600, sim: true } }
const c2 = { id: 'c2', name: 'C2', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM4', baudrate: 9600, sim: true } }
const f = (cid, i) => ({ frameId: cid + '-f' + i, connectionId: cid, t: 1000 + i, at: 1000 + i, direction: 'tx', request: 'r' + i, label: 'L' + i, status: 'ok' })

let _clearFramesByConnection = null
async function clearFramesByConnection(home, cwd, opts) {
  if (!_clearFramesByConnection) {
    _clearFramesByConnection = (await import('../bench-store.mjs').catch(()=>({}))).clearFramesByConnection
  }
  if (!_clearFramesByConnection) return { ok: false, error: 'clearFramesByConnection not implemented (Task1 pending)' }
  return _clearFramesByConnection(home, cwd, opts)
}
async function seed(home, cwd) {
  await mkdirSync(cwd)
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [c1, c2],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }, { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 2 }],
      points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'P1', area: 'holdingRegister', function: 3, address: 0 }],
      framesByConnection: { c1: [f('c1', 1), f('c1', 2)], c2: [f('c2', 1)] },
    },
  })
}

test('clear c1 then reload keeps c2 only (must FAIL on merge semantics)', async () => {
  const home = await mkdtemp(join(tmpdir(), 'fc-clear1-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    const r = await clearFramesByConnection(home, cwd, { connectionId: 'c1' })
    assert.equal(r && r.ok, true, 'clear must succeed: '+JSON.stringify(r))
    const ws = loadWorkspace(home, cwd)
    const fbc = ws.modbus.framesByConnection || {}
    assert.ok(!('c1' in fbc), 'c1 frames must be removed after clear+reload')
    assert.ok(Array.isArray(fbc.c2) && fbc.c2.length === 1, 'c2 frames must survive')
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('clear all then reload is empty and configVersion unchanged', async () => {
  const home = await mkdtemp(join(tmpdir(), 'fc-clearall-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    const before = loadWorkspace(home, cwd).modbus.configVersion
    const r = await clearFramesByConnection(home, cwd, { all: true })
    assert.equal(r && r.ok, true, 'clear all must succeed: ' + JSON.stringify(r))
    const ws = loadWorkspace(home, cwd)
    assert.deepEqual(ws.modbus.framesByConnection || {}, {}, 'all frames cleared')
    assert.equal(ws.modbus.configVersion, before, 'clear must not bump configVersion')
    // other config intact
    assert.equal(ws.modbus.connections.length, 2)
    assert.equal(ws.modbus.points.length, 1)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('clear an already-empty / unknown connection is idempotent & validated', async () => {
  const home = await mkdtemp(join(tmpdir(), 'fc-idem-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    // empty but valid connection c2 cleared twice → ok
    const r1 = await clearFramesByConnection(home, cwd, { connectionId: 'c2' })
    assert.equal(r1.ok, true)
    const r2 = await clearFramesByConnection(home, cwd, { connectionId: 'c2' })
    assert.equal(r2.ok, true, 'idempotent for empty valid connection')
    // unknown connection → error, not silent success
    const bad = await clearFramesByConnection(home, cwd, { connectionId: 'nope' })
    assert.equal(bad.ok, false)
    assert.match(String(bad.error || ''), /连接|不存在|connection/i)
  } finally { await rm(home, { recursive: true, force: true }) }
})

test('clear must not touch values/points/devices or bump version across several clears', async () => {
  const home = await mkdtemp(join(tmpdir(), 'fc-nocfg-'))
  const cwd = join(home, 'board')
  try {
    await seed(home, cwd)
    const before = loadWorkspace(home, cwd)
    await clearFramesByConnection(home, cwd, { all: true })
    const after = loadWorkspace(home, cwd)
    assert.deepEqual(after.modbus.connections, before.modbus.connections)
    assert.deepEqual(after.modbus.devices, before.modbus.devices)
    assert.deepEqual(after.modbus.points, before.modbus.points)
    assert.equal(after.modbus.configVersion, before.modbus.configVersion)
  } finally { await rm(home, { recursive: true, force: true }) }
})
