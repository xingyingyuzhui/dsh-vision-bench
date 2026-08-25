import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { commitReadResult, commitWriteResult } from '../bench-modbus-commit.mjs'
import { loadWorkspace, saveWorkspace } from '../bench-store.mjs'

test('commit merges point values incrementally and keeps drifted frames', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-commit-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        connections: [{ id: 'c1', name: 'A', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
        devices: [{ id: 'd1', connectionId: 'c1', unitId: 1 }],
        points: [
          { connectionId: 'c1', deviceId: 'd1', function: 3, address: 0 },
          { connectionId: 'c1', deviceId: 'd1', function: 3, address: 1 },
        ],
        configVersion: 3,
      },
    })
    let ws = loadWorkspace(home, cwd)
    const id0 = ws.modbus.points.find((p) => p.address === 0).id
    const id1 = ws.modbus.points.find((p) => p.address === 1).id
    saveWorkspace(home, cwd, { modbus: { values: [{ key: id0, pointId: id0, raw: 1, value: 1, ok: true }] } })
    await commitReadResult(home, cwd, {
      baseConfigVersion: ws.modbus.configVersion,
      connectionId: 'c1',
      deviceId: 'd1',
      pointValues: [{ key: id1, pointId: id1, raw: 9, value: 9, ok: true }],
      frame: { id: 't1', frameId: 't1', transactionId: 't1', connectionId: 'c1' },
    })
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.values.find((v) => v.pointId === id0 || v.key === id0).raw, 1)
    assert.equal(ws.modbus.values.find((v) => v.pointId === id1 || v.key === id1).raw, 9)
    await commitWriteResult(home, cwd, {
      baseConfigVersion: 1,
      connectionId: 'gone',
      deviceId: 'd1',
      pointValues: [{ key: 'p1', pointId: 'p1', raw: 99, value: 99, ok: true }],
      frame: { id: 't2', frameId: 't2', transactionId: 't2', connectionId: 'gone' },
    })
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.values.find((v) => v.pointId === id0 || v.key === id0).raw, 1)
    assert.ok(ws.modbus.framesByConnection.gone || ws.modbus.framesByConnection.c1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
