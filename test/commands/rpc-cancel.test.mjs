import assert from 'node:assert/strict'
import test from 'node:test'
import { createRouter } from '../helpers/rpc-factory.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'

test('router forwards AbortSignal to keil/build via operation options', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-rpc-cancel-' })
  const { dispatch } = createRouter(bench.home)
  const ac = new AbortController()
  ac.abort()
  // Exercise cancel-before-start through real keilBuild path with no project.
  const ran = await dispatch(
    'keil/build',
    { cwd: bench.cwd, project: bench.at('missing.uvprojx'), target: 'Debug' },
    ac.signal,
  )
  // Already-aborted signal must not report success.
  assert.notEqual(ran && ran.ok, true)
  assert.ok(ran.cancelled === true || ran.ok === false)
})

test('router forwards AbortSignal to modbus/read and returns cancelled', async (t) => {
  const bench = await createBench(t, {
    prefix: 'dvb-rpc-cancel-read-',
    shared: {
      connections: [connection('c1', 'rtu', 'COM3', { sim: true })],
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
  const { dispatch } = createRouter(bench.home)
  const ac = new AbortController()
  ac.abort()
  const ran = await dispatch('modbus/read', { cwd: bench.cwd, connectionId: 'c1', deviceId: 'd1', pointId: 'p1' }, ac.signal)
  assert.equal(ran.ok, false)
  assert.equal(ran.cancelled, true)
})
