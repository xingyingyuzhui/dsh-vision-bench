import assert from 'node:assert/strict'
import { mkdirSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { appendTransactionFrame, commitReadResult } from '../../bench-modbus-commit.mjs'
import { loadWorkspace, saveWorkspace, workspaceRepository } from '../../bench-store.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'

const seed = (home, cwd, extra = {}) => {
  mkdirSync(cwd, { recursive: true })
  return saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: 'T',
          function: 3,
          address: 0,
          monitorEnabled: true,
          alarmEnabled: true,
          alarmMax: 80,
        },
      ],
      ...extra,
    },
  })
}

test('config update concurrent with runtime commits does not drop values/trend/alarms/frames/tasks', async () => {
  const loops = 100
  for (let i = 0; i < loops; i++) {
    const home = await mkdtemp(join(tmpdir(), 'dvb-race-'))
    const cwd = join(home, 'board')
    seed(home, cwd)
    const cv = loadWorkspace(home, cwd).modbus.configVersion
    const name = `C1-${i}`
    const at = Date.now()
    await Promise.all([
      mutateConfig({
        home,
        cwd,
        source: 'user',
        expectedConfigVersion: cv,
        operation: 'connection.update',
        target: { connectionId: 'c1' },
        value: { name },
      }),
      commitReadResult(home, cwd, {
        connectionId: 'c1',
        deviceId: 'd1',
        pointValues: [{ pointId: 'p1', key: 'p1', raw: 42 + (i % 7), value: 42 + (i % 7), ok: true, at }],
        frame: {
          id: `f-${i}`,
          connectionId: 'c1',
          direction: 'rx',
          hex: '0103',
          at,
          status: 'ok',
        },
      }),
      appendTransactionFrame(home, cwd, {
        id: `tx-${i}`,
        connectionId: 'c1',
        direction: 'tx',
        hex: '0106',
        at,
        status: 'ok',
      }),
      workspaceRepository(home).mutateRuntime(cwd, (ws) => ({
        workspace: {
          ...ws,
          tasks: [
            ...(ws.tasks || []),
            {
              id: `t${i}`,
              type: 'read',
              source: 'user',
              status: 'ok',
              summary: `loop-${i}`,
              startedAt: Date.now(),
              endedAt: Date.now(),
            },
          ],
        },
      })),
    ])
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.modbus.connections[0].name, name, `loop ${i}: config name`)
    const rec = (ws.modbus.values || []).find((v) => v.pointId === 'p1' || v.key === 'p1')
    assert.ok(rec && rec.ok === true, `loop ${i}: value kept`)
    assert.ok(Array.isArray(ws.modbus.trend?.p1) && ws.modbus.trend.p1.length > 0, `loop ${i}: trend kept`)
    assert.ok(ws.modbus.alarmState && typeof ws.modbus.alarmState === 'object', `loop ${i}: alarm state present`)
    const frames = ws.modbus.framesByConnection?.c1 || []
    assert.ok(frames.length >= 1, `loop ${i}: frames kept`)
    assert.ok(
      (ws.tasks || []).some((t) => String(t.summary || '').includes(`loop-${i}`)),
      `loop ${i}: task kept`,
    )
    await rm(home, { recursive: true, force: true })
  }
})
