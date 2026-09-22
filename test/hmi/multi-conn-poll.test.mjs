import assert from 'node:assert/strict'
import test from 'node:test'
import { modbusPoll } from '../../bench-modbus.mjs'
import { loadWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'
import { device, dualConnTopology, hrPoint, rtuSim } from './multi-conn-fixtures.mjs'

test('多连接轮询：两条 enabled 连接并行 poll，pollingByConnection 各自 lastOk', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-multi-poll-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'COM3' })
  const c2 = rtuSim('c2', 'COM4', { name: 'COM4' })
  const p1 = hrPoint('p-c1-hr0', 'c1', 'd1', 0, { name: 'C1-HR0' })
  const p2 = hrPoint('p-c1-hr1', 'c1', 'd1', 1, { name: 'C1-HR1' })
  const p3 = hrPoint('p-c2-hr0', 'c2', 'd2', 10, { name: 'C2-HR0' })
  bench.save({
    modbus: {
      ...dualConnTopology({
        connections: [c1, c2],
        devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
        points: [p1, p2, p3],
      }),
      activeConnectionId: 'c1',
      activeDeviceId: 'd1',
    },
  })
  const ran = await modbusPoll(home, cwd)
  assert.equal(ran.ok, true)
  assert.ok(ran.pollingByConnection)
  assert.ok(ran.pollingByConnection['c1'])
  assert.ok(ran.pollingByConnection['c2'])
  assert.equal(ran.pollingByConnection['c1'].lastOk, true)
  assert.equal(ran.pollingByConnection['c2'].lastOk, true)
  assert.ok(ran.pollingByConnection['c1'].lastAt > 0)
  assert.ok(ran.pollingByConnection['c2'].lastAt > 0)
  // 0.29.16 起仿真轮询记录 SIM TX/RX 报文（串口报文页）——按连接/设备/端口分轨。
  const frames = ran.framesLog || []
  assert.ok(frames.length > 0, 'sim poll records frames')
  assert.ok(frames.every((f) => f.source === 'polling' && f.status === 'ok' && f.label.startsWith('读 ')))
  const route = { c1: { deviceId: 'd1', port: 'COM3' }, c2: { deviceId: 'd2', port: 'COM4' } }
  for (const f of frames) {
    assert.ok(route[f.connectionId], `unexpected frame connection ${f.connectionId}`)
    assert.equal(f.deviceId, route[f.connectionId].deviceId, 'frame device must match its connection')
    assert.equal(f.port, route[f.connectionId].port, 'frame port must match its connection')
  }
  assert.ok(frames.some((f) => f.connectionId === 'c1'), 'c1 frames recorded')
  assert.ok(frames.some((f) => f.connectionId === 'c2'), 'c2 frames recorded')
  assert.equal(new Set(frames.map((f) => f.transactionId)).size, frames.length, 'frame transaction ids unique')
  // framesByConnection 分轨持久化，互不串扰。
  assert.ok((ran.framesByConnection?.['c1'] || []).length > 0)
  assert.ok((ran.framesByConnection?.['c2'] || []).length > 0)
  assert.ok(ran.framesByConnection['c1'].every((f) => f.connectionId === 'c1'))
  assert.ok(ran.framesByConnection['c2'].every((f) => f.connectionId === 'c2'))
  assert.equal(ran.values.filter((v) => v.ok).length, 3)
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.modbus.values.filter((v) => v.ok).length, 3)
  assert.equal(ws.modbus.pollingByConnection['c1'].lastOk, true)
  assert.equal(ws.modbus.pollingByConnection['c2'].lastOk, true)
  const ranOnly = await modbusPoll(home, cwd, { connectionId: 'c1' })
  assert.equal(ranOnly.ok, true)
})

test('多连接轮询跳过 disabled 连接', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-poll-dis-' })
  const { home, cwd } = bench
  const c1 = rtuSim('c1', 'COM3', { name: 'C1' })
  const c2 = rtuSim('c2', 'COM4', { name: 'C2', enabled: false })
  bench.save({
    modbus: dualConnTopology({
      connections: [c1, c2],
      devices: [device('d1', 'c1', 1, 'D1'), device('d2', 'c2', 2, 'D2')],
      points: [
        hrPoint('p1', 'c1', 'd1', 0),
        hrPoint('p2', 'c2', 'd2', 0),
      ],
    }),
  })
  const ran = await modbusPoll(home, cwd)
  assert.equal(ran.ok, true)
  assert.equal(ran.pollingByConnection['c1'].lastOk, true)
  assert.equal(ran.values.filter((v) => v && v.ok && String(v.key || v.pointId).startsWith('p1')).length >= 1, true)
  assert.equal(
    (ran.values || []).some((v) => v && String(v.key || v.pointId) === 'p2' && v.ok),
    false,
    'disabled connection points must not be polled',
  )
  // 0.29.16 起仿真轮询记录报文；disabled 连接不得产生任何帧或帧环。
  const frames = ran.framesLog || []
  assert.ok(frames.length > 0, 'sim poll records frames')
  assert.ok(
    frames.every((f) => f.connectionId === 'c1' && f.deviceId === 'd1'),
    'disabled connection must not produce frames',
  )
  assert.equal(ran.framesByConnection?.['c2'], undefined, 'disabled connection must not produce frames key')
  assert.ok((ran.framesByConnection?.['c1'] || []).length > 0)
})

test('pollingByConnection 启用状态 per-connection 隔离', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-polling-isolate-' })
  const { home, cwd } = bench
  bench.save({
    modbus: dualConnTopology({
      pollingByConnection: {
        c1: { enabled: true, intervalMs: 500 },
        c2: { enabled: false, intervalMs: 1000 },
      },
    }),
  })
  const ws = loadWorkspace(home, cwd)
  assert.equal(ws.modbus.pollingByConnection['c1'].enabled, true)
  assert.equal(ws.modbus.pollingByConnection['c1'].intervalMs, 500)
  assert.equal(ws.modbus.pollingByConnection['c2'].enabled, false)
  assert.equal(ws.modbus.pollingByConnection['c2'].intervalMs, 1000)
})
