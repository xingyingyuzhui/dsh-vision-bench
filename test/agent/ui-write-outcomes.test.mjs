import assert from 'node:assert/strict'
import test from 'node:test'
import { ERROR_CODES, modbusWrite, resolvePendingWrite } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import { mutateConfig } from '../../src/application/config/config-mutation-service.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import {
  agentDevice,
  agentHrPoint,
  agentRtu,
  agentTcp,
  matchingReadbackTransport,
  writeTimeoutTransport,
} from './ui-fixtures.mjs'

test('approved write reports protocol result and readback consistency (§16.5-34)', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-agent-readback-' })
  const { home, cwd } = bench
  const transport = matchingReadbackTransport(7)
  bench.save({
    modbus: {
      version: 3,
      connections: [agentTcp('c1', { name: 'C1' })],
      devices: [agentDevice('d1', 'c1', 1, 'D1')],
      points: [agentHrPoint('p1', 'c1', 'd1', 0, { name: 'T1' })],
    },
  })
  const okReq = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [7] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  const okRun = await resolvePendingWrite(home, cwd, okReq.requestId, true, { transport, sessionId: 's1' })
  assert.equal(okRun.ok, true)
  assert.match(okRun.summary, /回读一致/)
  assert.deepEqual(okRun.readback, [7])
  assert.ok(okRun.frames && okRun.frames.request)
  const badReq = await runVisionBench(
    home,
    { action: 'write', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, values: [5] },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  const badRun = await resolvePendingWrite(home, cwd, badReq.requestId, true, { transport, sessionId: 's1' })
  assert.equal(badRun.ok, false)
  assert.equal(badRun.errorCode, ERROR_CODES.WRITE_READBACK_MISMATCH)
  assert.match(badRun.summary || badRun.error, /回读不一致/)
})

test('write timeout is outcome-unknown and not retried', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-unknown-' })
  const { home, cwd } = bench
  const transport = writeTimeoutTransport()
  bench.save({
    modbus: {
      connections: [
        {
          id: 'c1',
          name: 'C1',
          enabled: true,
          conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 },
        },
      ],
      devices: [{ id: 'd1', connectionId: 'c1', unitId: 1 }],
      points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, name: 'T1' }],
    },
  })
  const ran = await modbusWrite(
    home,
    cwd,
    {
      source: 'user',
      connectionId: 'c1',
      deviceId: 'd1',
      function: 3,
      address: 0,
      values: [7],
    },
    { transport },
  )
  assert.equal(ran.ok, false)
  assert.equal(ran.errorCode, ERROR_CODES.WRITE_OUTCOME_UNKNOWN)
  assert.equal(ran.outcomeUnknown, true)
  assert.equal(ran.retryable, false)
  assert.match(ran.error, /未知/)
})

test('direct config mutation refuses stale expectedConfigVersion', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-agent-mut-' })
  const { home, cwd } = bench
  const c1 = agentRtu('c1', 'COM3', { name: 'C1', baudrate: 9600 })
  bench.save({
    modbus: {
      version: 3,
      connections: [c1],
      devices: [agentDevice('d1', 'c1', 1, 'D1')],
      points: [],
    },
  })
  const cv = loadWorkspace(home, cwd).modbus.configVersion
  const first = await mutateConfig({
    home,
    cwd,
    source: 'agent',
    expectedConfigVersion: cv,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'C1-renamed' },
  })
  assert.equal(first.ok, true)
  const drifted = await mutateConfig({
    home,
    cwd,
    source: 'agent',
    expectedConfigVersion: cv,
    operation: 'connection.update',
    target: { connectionId: 'c1' },
    value: { name: 'C1-stale' },
  })
  assert.equal(drifted.ok, false)
  assert.equal(drifted.errorCode, 'CONFIG_DRIFT')
  const agentDraft = await runVisionBench(home, { action: 'draft', op: 'create' }, cwd, { source: 'agent' })
  assert.equal(agentDraft.ok, false)
  assert.equal(agentDraft.errorCode, 'OP_REMOVED')
})
