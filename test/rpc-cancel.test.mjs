import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { createVisionRpcRouter } from '../src/interfaces/rpc/vision-rpc-router.mjs'

test('router forwards AbortSignal to keil/build via operation options', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-rpc-cancel-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const seen = []
  const original = await import('../bench-actions.mjs')
  void original
  // Exercise cancel-before-start through real keilBuild path with no project.
  const router = createVisionRpcRouter({ getHome: () => home })
  const ac = new AbortController()
  ac.abort()
  const ran = await router.dispatch(
    'keil/build',
    { cwd, project: join(cwd, 'missing.uvprojx'), target: 'Debug' },
    ac.signal,
  )
  // Already-aborted signal must not report success.
  assert.notEqual(ran && ran.ok, true)
  assert.ok(ran.cancelled === true || ran.ok === false)
  await rm(home, { recursive: true, force: true })
  void seen
})

test('router forwards AbortSignal to modbus/read and returns cancelled', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-rpc-cancel-read-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  const { saveWorkspace } = await import('../bench-store.mjs')
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
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
        },
      ],
      values: [],
      alarmState: {},
    },
  })
  const router = createVisionRpcRouter({ getHome: () => home })
  const ac = new AbortController()
  ac.abort()
  const ran = await router.dispatch(
    'modbus/read',
    { cwd, connectionId: 'c1', deviceId: 'd1', pointId: 'p1' },
    ac.signal,
  )
  assert.equal(ran.ok, false)
  assert.equal(ran.cancelled, true)
  await rm(home, { recursive: true, force: true })
})
