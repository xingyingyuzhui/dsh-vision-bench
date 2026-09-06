import assert from 'node:assert/strict'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { toEndpoint, validateIoRequest } from '../bench-io-contract.mjs'
import { listConnectionStates } from '../bench-serial-monitor.mjs'
import { workspaceRepository } from '../bench-store.mjs'
import { createVisionRpcRouter } from '../src/interfaces/rpc/vision-rpc-router.mjs'

test('toEndpoint preserves sim flag', () => {
  const rtuSim = toEndpoint({ conn: { mode: 'rtu', port: '', sim: true } })
  assert.equal(rtuSim.sim, true)
  assert.equal(rtuSim.mode, 'rtu')

  const tcpSim = toEndpoint({ conn: { mode: 'tcp', host: '', sim: true } })
  assert.equal(tcpSim.sim, true)
  assert.equal(tcpSim.mode, 'tcp')

  const normal = toEndpoint({ conn: { mode: 'rtu', port: 'COM1', sim: false } })
  assert.equal(normal.sim, false)
})

test('validateIoRequest permits empty port/host when endpoint is simulated', () => {
  const openSim = validateIoRequest({
    v: 1,
    id: 'req1',
    op: 'connection.open',
    cwd: '/fake/ws',
    connectionId: 'c1',
    endpoint: { mode: 'rtu', port: '', sim: true },
  })
  assert.equal(openSim.ok, true, 'simulated connection.open succeeds without COM port')

  const openRealMissing = validateIoRequest({
    v: 1,
    id: 'req2',
    op: 'connection.open',
    cwd: '/fake/ws',
    connectionId: 'c1',
    endpoint: { mode: 'rtu', port: '', sim: false },
  })
  assert.equal(openRealMissing.ok, false)
  assert.equal(openRealMissing.error?.message, '缺少串口')

  const readSim = validateIoRequest({
    v: 1,
    id: 'req3',
    op: 'modbus.read',
    cwd: '/fake/ws',
    connectionId: 'c1',
    deviceId: 'd1',
    unitId: 1,
    functionCode: 3,
    address: 0,
    count: 2,
    endpoint: { mode: 'rtu', port: '', sim: true },
  })
  assert.equal(readSim.ok, true, 'simulated modbus.read succeeds without COM port')
})

test('RPC connection/open and connection/close return simulated: true for sim connections', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dsh-sim-test-'))
  const cwd = join(home, 'ws')
  const { saveWorkspace } = await import('../bench-store.mjs')
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [
        {
          id: 'c1',
          name: '仿真连接',
          role: 'client',
          enabled: true,
          conn: { mode: 'rtu', port: '', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1, sim: true },
        },
      ],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [],
      pollingByConnection: { c1: { enabled: true, intervalMs: 1000 } },
    },
  })

  const router = createVisionRpcRouter({ getHome: () => home })

  const openRes = await router.dispatch('connection/open', {
    cwd,
    connectionId: 'c1',
    sessionId: 'test-session',
  })
  assert.deepEqual(openRes, { ok: true, skipped: true, simulated: true })

  const closeRes = await router.dispatch('connection/close', {
    cwd,
    connectionId: 'c1',
    sessionId: 'test-session',
  })
  assert.deepEqual(closeRes, { ok: true, skipped: true, simulated: true })

  const st = await listConnectionStates(home, cwd, { sessionId: 'test-session' })
  assert.equal(st.connectionStates.length, 1)
  assert.equal(st.connectionStates[0].status, 'connected')
  assert.equal(st.connectionStates[0].simulated, true)

  await rm(home, { recursive: true, force: true })
})
