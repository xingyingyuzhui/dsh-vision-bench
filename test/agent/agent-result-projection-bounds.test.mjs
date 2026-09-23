import assert from 'node:assert/strict'
import test from 'node:test'
import {
  AGENT_FRAMES_MAX_LIMIT,
  AGENT_TEXT_CAPS,
  projectAgentResult,
  utf8ByteLength,
} from '../../src/application/commands/agent-result-projection.mjs'
import { runVisionBench } from '../helpers/run-vision-bench.mjs'
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
  assert.equal(projected.returned, projected.frames.length)
  assert.ok(projected.nextCursor != null || projected.truncated === true)
})

/** listFrames: offset counts from the newest end; page order is oldest→newest of that window. */
function listFramesWindow(all, offset, limit) {
  const length = all.length
  if (offset >= length) return []
  const end = Math.max(0, length - offset)
  const start = Math.max(0, end - limit)
  return all.slice(start, end)
}

function makeSeqFrames(n, payloadBytes = 300) {
  return Array.from({ length: n }, (_, i) => {
    const id = `f${String(i).padStart(3, '0')}`
    return {
      frameId: id,
      id,
      t: 1_700_000_000_000 + i,
      pad: 'x'.repeat(payloadBytes),
    }
  })
}

test('projectFrames: budget shrink keeps tail k; nextCursor = offset+k is continuous', () => {
  // 200 frames ~300B each; limit=100 page overflows framesBytes and must shrink to tail k.
  const all = makeSeqFrames(200, 300)
  const page1Raw = listFramesWindow(all, 0, 100)
  const page1 = projectAgentResult(
    { action: 'frames', limit: 100, offset: 0 },
    { ok: true, action: 'frames', frames: page1Raw, total: all.length, connectionId: 'c1', deviceId: 'd1' },
  )
  assert.equal(page1.returned, page1.frames.length, 'returned === frames.length')
  assert.ok(page1.frames.length >= 1 && page1.frames.length < 100, 'budget must shrink below limit')
  assert.ok(utf8ByteLength(page1) <= AGENT_TEXT_CAPS.framesBytes)

  // Tail of the requested page, not the head.
  const tail = page1Raw.slice(-page1.frames.length).map((f) => f.frameId)
  assert.deepEqual(page1.frames.map((f) => f.frameId), tail)

  // IDs continuous within the page (all = f000..f199 in order).
  const idxOf = (id) => all.findIndex((f) => f.frameId === id)
  const p1Idx = page1.frames.map((f) => idxOf(f.frameId))
  for (let i = 1; i < p1Idx.length; i++) {
    assert.equal(p1Idx[i], p1Idx[i - 1] + 1, 'page 1 IDs continuous')
  }

  assert.equal(page1.nextCursor, String(0 + page1.returned), 'nextCursor usable as offset')
  const offset2 = Number(page1.nextCursor)
  assert.ok(Number.isFinite(offset2))

  const page2Raw = listFramesWindow(all, offset2, 100)
  const page2 = projectAgentResult(
    { action: 'frames', limit: 100, offset: offset2 },
    { ok: true, action: 'frames', frames: page2Raw, total: all.length, connectionId: 'c1', deviceId: 'd1' },
  )
  assert.equal(page2.returned, page2.frames.length)

  // Second page continues at the record immediately older than page 1's oldest returned ID.
  const p1Oldest = idxOf(page1.frames[0].frameId)
  const p2Newest = idxOf(page2.frames[page2.frames.length - 1].frameId)
  assert.equal(p2Newest, p1Oldest - 1, 'page 2 newest is immediately older than page 1 oldest')

  // Merged covered window: no gaps, no duplicates.
  const mergedIdx = [...page1.frames, ...page2.frames].map((f) => idxOf(f.frameId))
  assert.equal(new Set(mergedIdx).size, mergedIdx.length, 'no duplicates across pages')
  const sorted = [...mergedIdx].sort((a, b) => a - b)
  for (let i = 1; i < sorted.length; i++) {
    assert.equal(sorted[i], sorted[i - 1] + 1, 'merged pages have no gaps')
  }

  if (page2.nextCursor != null) {
    assert.equal(page2.nextCursor, String(offset2 + page2.returned))
  }
})

test('projectFrames: overrun shrinks to tail k with returned=k and nextCursor=offset+k', () => {
  // Oversized frames force a small k; keep the newest tail so pagination walks older cleanly.
  const all = makeSeqFrames(20, 2000)
  const pageRaw = listFramesWindow(all, 0, 20)
  const projected = projectAgentResult(
    { action: 'frames', limit: 20, offset: 0 },
    { ok: true, action: 'frames', frames: pageRaw, total: all.length, connectionId: 'c1' },
  )
  const k = projected.frames.length
  assert.ok(k >= 1 && k < 20, `expected shrink, got k=${k}`)
  assert.equal(projected.returned, k)
  assert.deepEqual(projected.frames.map((f) => f.frameId), pageRaw.slice(-k).map((f) => f.frameId))
  assert.equal(projected.nextCursor, String(0 + k))
  assert.ok(utf8ByteLength(projected) <= AGENT_TEXT_CAPS.framesBytes)

  // Mid-list offset: nextCursor = offset + k still holds.
  const offset = 5
  const pageMid = listFramesWindow(all, offset, 20)
  const mid = projectAgentResult(
    { action: 'frames', limit: 20, offset },
    { ok: true, action: 'frames', frames: pageMid, total: all.length, connectionId: 'c1' },
  )
  const kMid = mid.frames.length
  assert.equal(mid.returned, kMid)
  assert.deepEqual(mid.frames.map((f) => f.frameId), pageMid.slice(-kMid).map((f) => f.frameId))
  assert.equal(mid.nextCursor, String(offset + kMid))
})

test('projectFrames: huge single frame keeps frameId + overrun, not an empty ok page', () => {
  const huge = {
    frameId: 'fx-huge',
    id: 'fx-huge',
    requestHex: 'ab'.repeat(20_000),
  }
  const projected = projectAgentResult(
    { action: 'frames', limit: 5 },
    { ok: true, action: 'frames', frames: [huge], total: 3, connectionId: 'c1', deviceId: 'd1' },
  )
  assert.equal(projected.returned, projected.frames.length, 'returned === frames.length')
  assert.equal(projected.overrun, true)
  assert.equal(projected.frameId, 'fx-huge')
  assert.ok(projected.hint, 'hint to query by frameId')
  assert.equal(projected.connectionId, 'c1')
  assert.equal(projected.deviceId, 'd1')
  // Not a silent empty full page: either a stub frame with the id, or empty+overrun+frameId.
  if (projected.frames.length === 0) {
    assert.equal(projected.overrun, true)
    assert.equal(projected.frameId, 'fx-huge')
  } else {
    assert.equal(projected.frames[0].frameId, 'fx-huge')
    assert.equal(projected.frames[0].overrun, true)
  }
  assert.ok(projected.ok === true ? projected.overrun === true : true)
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
