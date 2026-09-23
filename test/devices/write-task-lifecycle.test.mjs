import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusWrite } from '../../bench-actions.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { hasRunning } from '../../src/domain/modbus/journal-model.mjs'
import { connection, createBench } from '../helpers/workspace-factory.mjs'
import { device, hrPoint, rtuSim } from '../hmi/multi-conn-fixtures.mjs'

test('sim write save failure closes the write task so the next write can run', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-save-fail-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      share: { enabled: true, connections: true, points: true, visualization: false },
      connections: [rtuSim('c1', 'COM3')],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
      sessionConfigs: { s1: { connections: [], devices: [], points: [] } },
      values: [],
    },
  })
  const failed = await modbusWrite(home, cwd, {
    source: 'user',
    function: 3,
    address: 0,
    values: [7],
    connectionId: 'c1',
    deviceId: 'd1',
  })
  assert.equal(failed.ok, false)
  assert.equal(failed.errorCode, 'SESSION_REQUIRED')
  assert.equal(hasRunning(loadWorkspace(home, cwd), 'write'), false, 'failed save must not leave a running write task')

  const again = await modbusWrite(
    home,
    cwd,
    {
      source: 'user',
      sessionId: 's1',
      function: 3,
      address: 0,
      values: [7],
      connectionId: 'c1',
      deviceId: 'd1',
    },
    { sessionId: 's1' },
  )
  assert.equal(again.ok, true, again.error)
  assert.equal(hasRunning(loadWorkspace(home, cwd), 'write'), false)
})

test('a throwing transport closes the write task', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-throw-' })
  const { home, cwd } = bench
  bench.save({
    modbus: {
      version: 3,
      connections: [connection('c1', 'tcp', '', { host: '127.0.0.1', sim: false })],
      devices: [device('d1', 'c1', 1)],
      points: [hrPoint('p1', 'c1', 'd1', 0)],
      values: [],
    },
  })
  await assert.rejects(
    () =>
      modbusWrite(
        home,
        cwd,
        {
          source: 'user',
          function: 3,
          address: 0,
          values: [1],
          connectionId: 'c1',
          deviceId: 'd1',
        },
        {
          transport: {
            write: async () => {
              throw new Error('bus down')
            },
          },
        },
      ),
    /bus down/,
  )
  assert.equal(hasRunning(loadWorkspace(home, cwd), 'write'), false, 'a thrown write must not leave a running task')
})
