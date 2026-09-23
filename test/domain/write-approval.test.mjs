import assert from 'node:assert/strict'
import test from 'node:test'
import { listPendingWrites, resolvePendingWrite } from '../../bench-actions.mjs'
import { journalView, loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
import { projectModbusForSession } from '../../src/application/modbus/config-scope-service.mjs'
import { saveSessionModbusPatch } from '../../src/application/modbus/workspace-session-view.mjs'
import { createBench, pointSeries } from '../helpers/workspace-factory.mjs'

test('runVisionBench write action requires user approval then executes', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-tool-write-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      conn: { sim: true },
      points: pointSeries('保持', 10),
    },
  })
  const first = await runVisionBench(
    home,
    {
      action: 'write',
      function: 3,
      address: 5,
      values: [42, 43],
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.ok, false)
  assert.equal(first.needsConfirm, true)
  assert.ok(first.requestId)
  assert.deepEqual(listPendingWrites(cwd, 's1').find((item) => item.id === first.requestId)?.values, [42, 43])
  const untouched = loadWorkspace(home, cwd).modbus.values
  assert.equal((untouched || []).length, 0)

  const ran = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: 's1' })
  assert.equal(ran.ok, true)
  assert.deepEqual(ran.target, [42, 43])
  assert.deepEqual(ran.readback, [42, 43])
  const ws = loadWorkspace(home, cwd)
  const task = journalView(ws).tasks.find((item) => item.type === 'write')
  assert.equal(task.source, 'agent')
  assert.equal(task.sessionId, 's1')
  const pts = projectModbusForSession(ws.modbus, 's1').points.filter(
    (p) => (p.function === 3 || p.area === 'holdingRegister') && (p.address === 5 || p.address === 6),
  )
  assert.equal(pts.length, 2)
  const ptIds = new Set(pts.map((p) => p.id))
  const rec = ws.modbus.values.filter((item) => ptIds.has(item.key) || ptIds.has(item.pointId))
  assert.equal(rec.length, 2)

  const gone = await resolvePendingWrite(home, cwd, first.requestId, false, { sessionId: 's1' })
  assert.equal(gone.ok, false)
})

test('rejecting a pending agent write leaves the device untouched', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-tool-reject-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      sim: true,
      segments: [{ name: '保持', function: 3, address: 0, count: 10 }],
    },
  })
  const first = await runVisionBench(
    home,
    {
      action: 'write',
      function: 3,
      address: 1,
      values: [7],
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  const ran = await resolvePendingWrite(home, cwd, first.requestId, false, { sessionId: 's1' })
  assert.equal(ran.ok, true)
  assert.equal(ran.rejected, true)
  const ws = loadWorkspace(home, cwd)
  assert.equal((ws.modbus.devices[0].values || []).length, 0)
  assert.ok(ws.timeline.some((item) => item.kind === 'write-reject' && item.ok === false))
  assert.equal(journalView(ws).tasks.filter((item) => item.type === 'write').length, 0)
})

test('approving a pending write whose device vanished fails cleanly', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-gone-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      devices: [
        {
          id: 'm1',
          name: '主机',
          role: 'master',
          sim: true,
          segments: [{ id: 's1', name: '保持', function: 3, address: 0, count: 10 }],
        },
      ],
      activeId: 'm1',
    },
  })
  const first = await runVisionBench(
    home,
    {
      action: 'write',
      function: 3,
      address: 0,
      values: [9],
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  // Simulate the connection drifting between request and approval.
  const claimed = projectModbusForSession(loadWorkspace(home, cwd).modbus, 's1')
  const goneConns = (claimed.connections || []).map((c) => ({
    ...c,
    conn: { ...(c.conn || {}), port: 'COM9', baudrate: 9600, slave: 1, sim: true },
  }))
  const gone = await saveSessionModbusPatch(home, cwd, 's1', { modbus: { connections: goneConns } })
  assert.equal(gone.ok, true, gone.error)
  const ran = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: 's1' })
  assert.equal(ran.ok, false)
  assert.match(ran.error, /设备连接已变更/)
  const ws = loadWorkspace(home, cwd)
  const m2 = ws.modbus.devices.find((item) => item.id === 'm2')
  assert.equal(((m2 && m2.values) || []).length, 0)
})

test('approval refuses when the device endpoint drifted', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-drift-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      devices: [
        {
          id: 'm1',
          name: '主板',
          role: 'master',
          mode: 'tcp',
          host: '10.0.0.8',
          tcpPort: 502,
          slave: 1,
          segments: [{ id: 's1', name: '保持', function: 3, address: 0, count: 10 }],
        },
      ],
      activeId: 'm1',
    },
  })
  const first = await runVisionBench(
    home,
    {
      action: 'write',
      function: 3,
      address: 0,
      values: [5],
    },
    cwd,
    { source: 'agent', sessionId: 's-origin' },
  )
  assert.equal(first.needsConfirm, true)
  // User repoints the device at another controller before approving.
  const originPack = projectModbusForSession(loadWorkspace(home, cwd).modbus, 's-origin')
  const driftedConns = (originPack.connections || []).map((c) => ({
    ...c,
    conn: { ...(c.conn || {}), host: '10.9.9.9' },
  }))
  const drift = await saveSessionModbusPatch(home, cwd, 's-origin', { modbus: { connections: driftedConns } })
  assert.equal(drift.ok, true, drift.error)
  const ran = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: 's-origin' })
  assert.equal(ran.ok, false)
  assert.match(ran.error, /设备连接已变更/)
  const ws = loadWorkspace(home, cwd)
  assert.equal((ws.modbus.devices[0].values || []).length, 0)
  assert.ok(ws.timeline.some((item) => item.kind === 'write-stale'))
})

test('same-endpoint approval still executes', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-same-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      devices: [
        {
          id: 'm1',
          name: '主板',
          role: 'master',
          sim: true,
          segments: [{ id: 's1', name: '保持', function: 3, address: 0, count: 10 }],
        },
      ],
      activeId: 'm1',
    },
  })
  const first = await runVisionBench(
    home,
    {
      action: 'write',
      function: 3,
      address: 1,
      values: [6],
    },
    cwd,
    { source: 'agent', sessionId: 's-origin' },
  )
  assert.equal(first.needsConfirm, true)
  // Touch unrelated workspace state; the endpoint fingerprint must not care.
  saveWorkspace(home, cwd, { keil: { target: 'Debug' } })
  const ran = await resolvePendingWrite(home, cwd, first.requestId, true, { sessionId: 's-origin' })
  assert.equal(ran.ok, true)
  assert.deepEqual(ran.readback, [6])
})

test('missing approved field fails closed instead of approving', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-write-closed-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      devices: [
        {
          id: 'm1',
          name: '主板',
          role: 'master',
          sim: true,
          segments: [{ id: 's1', name: '保持', function: 3, address: 0, count: 10 }],
        },
      ],
      activeId: 'm1',
    },
  })
  const first = await runVisionBench(
    home,
    {
      action: 'write',
      function: 3,
      address: 0,
      values: [1],
    },
    cwd,
    { source: 'agent', sessionId: 's1' },
  )
  assert.equal(first.needsConfirm, true)
  // Route-level semantics: resolvePendingWrite treats anything but exactly
  // true as a rejection.
  const ran = await resolvePendingWrite(home, cwd, first.requestId, undefined, { sessionId: 's1' })
  assert.equal(ran.rejected, true)
  const ws = loadWorkspace(home, cwd)
  assert.equal((ws.modbus.devices[0].values || []).length, 0)
})
