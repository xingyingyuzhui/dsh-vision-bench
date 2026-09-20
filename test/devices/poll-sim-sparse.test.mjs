import assert from 'node:assert/strict'
import { mkdir } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'

test('modbusPoll sim sparse points fills all values with a single tick persist', async (t) => {
  const home = await createTempDir(t, 'dvb-poll-sparse-')
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const points = []
  for (let i = 0; i < 40; i++) {
    points.push({
      id: `p3_${i * 10}`,
      name: `hr${i * 10}`,
      function: 3,
      address: i * 10,
      connectionId: 'c1',
      deviceId: 'd1',
      monitorEnabled: true,
    })
  }
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [
        {
          id: 'c1',
          name: 'sim',
          role: 'client',
          enabled: true,
          conn: { mode: 'rtu', port: '', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1, sim: true },
        },
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points,
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' } },
    },
  })

  const started = Date.now()
  const ran = await modbusPoll(home, cwd, { connectionId: 'c1' })
  const elapsed = Date.now() - started
  assert.equal(ran.ok, true, ran.error)
  assert.equal(Array.isArray(ran.framesLog) && ran.framesLog.length, 0, 'sim must not synthesize frames')
  const ws = loadWorkspace(home, cwd)
  const filled = (ws.modbus.values || []).filter((v) => v.ok).length
  assert.equal(filled, 40)
  assert.ok(elapsed < 3000, `sparse sim poll should stay cheap (took ${elapsed}ms)`)
  assert.equal(ws.modbus.pollingByConnection.c1.lastOk, true)
})
