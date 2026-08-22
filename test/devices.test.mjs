import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { normalizeConn, normalizeModbus, connLabel, patchConn } from '../bench-devices.mjs'
import { modbusPoll } from '../bench-modbus.mjs'
import { saveWorkspace } from '../bench-store.mjs'

test('normalizeConn applies defaults and clamps', () => {
  const c = normalizeConn({ mode: 'tcp', baudrate: 0, bytesize: 9, parity: 'X', stopbits: 7, slave: 300 })
  assert.equal(c.mode, 'tcp')
  assert.equal(c.baudrate, 9600)
  assert.equal(c.bytesize, 8)
  assert.equal(c.parity, 'N')
  assert.equal(c.stopbits, 1)
  assert.equal(c.slave, 247)
  const rtu = normalizeConn({ port: ' COM3 ', parity: 'E', stopbits: 2, bytesize: 7 })
  assert.equal(rtu.mode, 'rtu')
  assert.equal(rtu.port, 'COM3')
  assert.equal(rtu.parity, 'E')
  assert.equal(rtu.stopbits, 2)
  assert.equal(rtu.bytesize, 7)
})

test('legacy devices+segments workspaces migrate into points', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-migrate-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        mode: 'rtu',
        port: 'COM5',
        baudrate: 19200,
        slave: 3,
        sim: true,
        segments: [
          { id: 'sA', name: '温度块', function: 3, address: 0, count: 2, scale: 0.1, offset: -40, unit: '℃' },
          { id: 'sB', name: '阀门', function: 1, address: 9, count: 1 },
        ],
        values: [{ key: 'sB:1@9', value: 1, raw: true, ok: true, at: 42 }],
      },
    })
    const ws = await import('../bench-store.mjs').then((m) => m.loadWorkspace(home, cwd))
    const mb = ws.modbus
    assert.equal(mb.version, 2)
    assert.equal(mb.conn.port, 'COM5')
    assert.equal(mb.conn.slave, 3)
    assert.equal(mb.conn.sim, true)
    assert.equal(mb.points.length, 3)
    assert.deepEqual(mb.points.map((p) => p.id), ['p3_0', 'p3_1', 'p1_9'])
    // batch segment drops its block name; single-point segment keeps it
    assert.equal(mb.points[2].name, '阀门')
    assert.equal(mb.points[0].scale, 0.1)
    // migrated values keep their payload under the new key
    const valve = mb.values.find((v) => v.key === 'p1_9')
    assert.ok(valve && valve.value === 1 && valve.at === 42)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('patchConn merges without touching points or values', () => {
  const base = normalizeModbus({
    conn: { port: 'COM3', baudrate: 9600 },
    points: [{ function: 3, address: 1 }],
    values: [{ key: 'p3_1', raw: 5, value: 5, ok: true, at: 1 }],
  })
  const next = patchConn(base, { baudrate: 19200, host: 'x' })
  assert.equal(next.conn.baudrate, 19200)
  assert.equal(next.conn.host, 'x')
  assert.equal(next.conn.port, 'COM3')
  assert.equal(next.points.length, 1)
  assert.equal(next.values.length, 1)
})

test('connLabel renders both modes', () => {
  assert.match(connLabel(normalizeConn({ port: 'COM3', baudrate: 9600, slave: 2 })), /COM3 @ 9600/)
  assert.match(connLabel(normalizeConn({ mode: 'tcp', host: '10.0.0.8', tcpPort: 1502, slave: 4 })), /10\.0\.0\.8:1502/)
})

test('modbusPoll reports missing points cleanly', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-poll-v2-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, { modbus: { conn: { sim: true } } })
    const ran = await modbusPoll(home, cwd)
    assert.equal(ran.ok, false)
    assert.match(ran.error, /无点位/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('modbusPoll sim path batches contiguous points and fills values', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-poll-batch-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        conn: { sim: true },
        polling: { enabled: true },
        points: [
          { name: 'a', function: 3, address: 0 },
          { name: 'b', function: 3, address: 1 },
          { name: 'c', function: 3, address: 2 },
        ],
      },
    })
    const ran = await modbusPoll(home, cwd)
    assert.equal(ran.ok, true)
    assert.ok(Array.isArray(ran.framesLog))
    const ws = await import('../bench-store.mjs').then((m) => m.loadWorkspace(home, cwd))
    const filled = ws.modbus.values.filter((v) => v.ok).length
    assert.equal(filled, 3)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
