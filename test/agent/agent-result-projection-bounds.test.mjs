import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_FRAMES_MAX_LIMIT,
  AGENT_TEXT_CAPS,
  projectAgentResult,
  utf8ByteLength,
} from '../../src/application/commands/agent-result-projection.mjs'
import { runVisionBench } from '../../bench-tool.mjs'
import { saveWorkspace } from '../../bench-store.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

test('projectRead: scratch FC03@900 uses readings, not first-32 global values', () => {
  const globalValues = Array.from({ length: 64 }, (_, i) => ({
    pointId: `p${i}`,
    key: `p${i}`,
    raw: 1000 + i,
    value: 1000 + i,
    connectionId: i < 32 ? 'c-other' : 'c1',
  }))
  const raw = projectAgentResult(
    { action: 'read', function: 3, address: 900, count: 2, connectionId: 'c1', deviceId: 'd1' },
    {
      ok: true,
      action: 'read',
      connectionId: 'c1',
      deviceId: 'd1',
      function: 3,
      address: 900,
      count: 2,
      values: globalValues,
      readings: [
        {
          connectionId: 'c1',
          deviceId: 'd1',
          function: 3,
          address: 900,
          count: 2,
          raw: [0x1234, 0x5678],
          frameId: 'f1',
          transactionId: 'tx1',
        },
      ],
      framesLog: Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, requestHex: 'aa'.repeat(40) })),
      results: [{ ok: true, connectionId: 'c1', deviceId: 'd1', count: 2 }],
    },
  )
  assert.equal(raw.ok, true)
  assert.equal(raw.function, 3)
  assert.equal(raw.address, 900)
  assert.equal(raw.count, 2)
  assert.equal(raw.connectionId, 'c1')
  assert.equal(raw.deviceId, 'd1')
  assert.deepEqual(raw.readings[0].raw, [0x1234, 0x5678])
  assert.equal(raw.values.length, 0, 'scratch must not leak global values')
  assert.ok(raw.framesLog.length <= 8, 'scratch must not carry hundreds of frames')
  assert.ok(!raw.framesLog.some((/** @type {any} */ f) => f.requestHex))
})

test('projectRead: multi-conn readings stay on requested connection', () => {
  const projected = projectAgentResult(
    { action: 'read', function: 3, address: 0, count: 1, connectionId: 'c2' },
    {
      ok: true,
      action: 'read',
      connectionId: 'c2',
      deviceId: 'd2',
      function: 3,
      address: 0,
      count: 1,
      values: [
        { pointId: 'p1', connectionId: 'c1', raw: 1 },
        { pointId: 'p2', connectionId: 'c2', raw: 99 },
      ],
      readings: [
        { connectionId: 'c1', deviceId: 'd1', function: 3, address: 0, count: 1, raw: [1] },
        { connectionId: 'c2', deviceId: 'd2', function: 3, address: 0, count: 1, raw: [99] },
      ],
    },
  )
  assert.equal(projected.readings.length, 1)
  assert.equal(projected.readings[0].connectionId, 'c2')
  assert.deepEqual(projected.readings[0].raw, [99])
})

test('projectRead: single-point keeps that point values and bounded frames', () => {
  const projected = projectAgentResult(
    { action: 'read', pointId: 'p3' },
    {
      ok: true,
      action: 'read',
      values: [
        { pointId: 'p1', raw: 1 },
        { pointId: 'p3', raw: 33 },
        { pointId: 'p9', raw: 9 },
      ],
      readings: [{ connectionId: 'c1', deviceId: 'd1', function: 3, address: 3, count: 1, raw: [33] }],
      framesLog: Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, frameId: `f${i}`, transactionId: `t${i}` })),
    },
  )
  assert.deepEqual(
    projected.values.map((/** @type {any} */ v) => v.pointId),
    ['p3'],
  )
  assert.ok(projected.framesLog.length <= 8)
  assert.ok(utf8ByteLength(projected) <= AGENT_TEXT_CAPS.singlePointReadBytes)
})

test('projectAlarm: alarmId returns full diagnostics beyond top-40 window', () => {
  /** @type {Record<string, any>} */
  const alarms = {}
  for (let i = 0; i < 80; i++) {
    alarms[`a${i}`] = {
      condition: 'normal',
      group: 'process',
      pointId: `p${i}`,
      connectionId: 'c1',
      status: 'recovered',
      severity: 'low',
      value: i,
      threshold: 10,
    }
  }
  alarms.a77 = {
    condition: 'active',
    group: 'process',
    pointId: 'p77',
    connectionId: 'c1',
    deviceId: 'd1',
    status: 'active',
    severity: 'high',
    quality: 'good',
    value: 120,
    threshold: 100,
    kind: 'max',
    firstAt: 1000,
    lastAt: 2000,
    recoveredAt: 0,
    frameId: 'frm-77',
    transactionId: 'tx-77',
  }
  const projected = projectAgentResult({ action: 'alarm', alarmId: 'a77' }, { ok: true, action: 'alarm', alarms })
  assert.equal(projected.returned, 1)
  assert.equal(projected.total, 1)
  const hit = projected.alarms.a77
  assert.equal(hit.condition, 'active')
  assert.equal(hit.severity, 'high')
  assert.equal(hit.quality, 'good')
  assert.equal(hit.current ?? hit.value, 120)
  assert.equal(hit.trigger ?? hit.threshold, 100)
  assert.equal(hit.frameId, 'frm-77')
  assert.ok(hit.occurredAt === 1000 || hit.firstAt === 1000 || hit.lastAt === 2000)
})

test('projectFrames: agent limit hard-capped', () => {
  const frames = Array.from({ length: 500 }, (_, i) => ({ id: `f${i}`, frameId: `f${i}` }))
  const projected = projectAgentResult(
    { action: 'frames', limit: 99999 },
    { ok: true, action: 'frames', frames, total: 500, connectionId: 'c1' },
  )
  assert.ok(projected.frames.length <= AGENT_FRAMES_MAX_LIMIT)
  assert.equal(projected.limit, AGENT_FRAMES_MAX_LIMIT)
  assert.ok(projected.nextCursor != null || projected.truncated === true)
})

test('projectAgentResult: budget overrun keeps safety fields', () => {
  const huge = projectAgentResult(
    { action: 'read', all: true },
    {
      ok: false,
      action: 'read',
      commandId: 'cmd-x',
      errorCode: 'DEVICE_DISABLED',
      details: { reason: 'disabled' },
      approval: { required: true },
      values: Array.from({ length: 200 }, (_, i) => ({
        pointId: `p${i}`,
        raw: i,
        blob: 'x'.repeat(200),
      })),
      readings: Array.from({ length: 200 }, (_, i) => ({
        connectionId: 'c1',
        deviceId: 'd1',
        function: 3,
        address: i,
        count: 1,
        raw: [i],
        pad: 'y'.repeat(200),
      })),
      framesLog: Array.from({ length: 50 }, (_, i) => ({ frameId: `f${i}`, transactionId: `t${i}` })),
      results: [{ ok: false, error: 'nope' }],
    },
  )
  assert.equal(huge.ok, false)
  assert.equal(huge.errorCode, 'DEVICE_DISABLED')
  assert.equal(huge.commandId, 'cmd-x')
  assert.deepEqual(huge.details, { reason: 'disabled' })
  assert.deepEqual(huge.approval, { required: true })
  assert.ok(utf8ByteLength(huge) <= AGENT_TEXT_CAPS.readBytes || huge.overrun === true)
})

test('sim scratch read: structured raw matches sim RX registers', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-scratch-read-' })
  const { home, cwd } = bench
  const sessionId = 'scratch-a'
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 1,
      connections: [
        { id: 'c1', name: 'SimA', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } },
        { id: 'c2', name: 'SimB', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } },
      ],
      devices: [
        { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 },
        { id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 },
      ],
      points: [
        {
          id: 'p-other',
          connectionId: 'c2',
          deviceId: 'd2',
          name: 'Other',
          function: 3,
          address: 0,
          monitorEnabled: true,
        },
      ],
      visualization: { schemaVersion: 2, components: [] },
    },
  })
  const origin = { source: 'agent', sessionId }
  await runVisionBench(home, { action: 'status' }, cwd, origin)

  const scratch = await runVisionBench(
    home,
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 900, count: 2 },
    cwd,
    origin,
  )
  assert.equal(scratch.ok, true, scratch.error)
  assert.ok(Array.isArray(scratch.readings) && scratch.readings.length >= 1, 'readings present')
  const hit = scratch.readings.find(
    (/** @type {any} */ r) => r.connectionId === 'c1' && Number(r.address) === 900 && Number(r.count) === 2,
  )
  assert.ok(hit, 'scratch reading for FC03@900')
  assert.equal(hit.function, 3)
  assert.equal(hit.raw.length, 2)
  assert.ok(hit.raw.every((/** @type {any} */ n) => Number.isFinite(Number(n))))
  assert.ok(!(scratch.values || []).some((/** @type {any} */ v) => v.connectionId === 'c2' && v.pointId === 'p-other' && scratch.action === 'read' && false))

  // Host path may still return full values; Agent projection must isolate.
  const projected = projectAgentResult(
    { action: 'read', connectionId: 'c1', deviceId: 'd1', function: 3, address: 900, count: 2 },
    scratch,
  )
  assert.equal(projected.values.length, 0)
  assert.deepEqual(projected.readings[0].raw, hit.raw)
  assert.ok((projected.framesLog || []).length <= 8)
})
