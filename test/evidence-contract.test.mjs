import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { readdirSync } from 'node:fs'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { buildAgentRef, evidenceFromRef, parseTrendKey, postEvidence } from '../bench-shared.mjs'
import { appendEvidence, loadWorkspace, normalizeFocusState, saveWorkspace } from '../bench-store.mjs'

// Task4/0.18.2: typed Evidence contract.
// Standard evidence shape: { kind, id, connectionId, deviceId, pointId, frameId,
// trendKey, alarmId, at, version, timeRange:{start,end} } — the kind decides which
// id field carries the target; a frame id must NEVER be treated as a point id.

async function setup(home, cwd) {
  await mkdir(cwd)
  const c1 = { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } }
  const d1 = { id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }
  const p1 = {
    id: 'p1',
    connectionId: 'c1',
    deviceId: 'd1',
    name: 'T1',
    area: 'holdingRegister',
    function: 3,
    address: 0,
  }
  const f1 = {
    id: 'f1',
    frameId: 'f1',
    connectionId: 'c1',
    deviceId: 'd1',
    t: 1000,
    at: 1000,
    direction: 'tx',
    request: 'req',
    response: 'res',
    status: 'ok',
    functionCode: 3,
  }
  const a1 = {
    id: 'a1',
    connectionId: 'c1',
    deviceId: 'd1',
    pointId: 'p1',
    condition: 'active',
    status: 'active',
    acknowledged: false,
    group: 'process',
    lastAt: 1000,
    firstAt: 1000,
  }
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [c1],
      devices: [d1],
      points: [p1],
      framesByConnection: { c1: [f1] },
      alarmState: { a1 },
    },
  })
  return loadWorkspace(home, cwd).modbus.configVersion
}

test('Task4: parseTrendKey enforces connectionId:deviceId:pointId shape', async () => {
  assert.deepEqual(parseTrendKey('c1:d1:p1'), { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' })
  assert.deepEqual(parseTrendKey(' c1 : d1 : p1 '), { connectionId: 'c1', deviceId: 'd1', pointId: 'p1' })
  assert.equal(parseTrendKey('bad'), null)
  assert.equal(parseTrendKey('c1:d1'), null)
  assert.equal(parseTrendKey(''), null)
  assert.equal(parseTrendKey(null), null)
})

test('Task4: buildAgentRef routes generic id by kind — frame id must not become pointId', async () => {
  const point = buildAgentRef('point', { id: 'p1', connectionId: 'c1', deviceId: 'd1' }, { configVersion: 2 })
  assert.equal(point.pointId, 'p1')
  const frame = buildAgentRef('frame', { id: 'f1', connectionId: 'c1', deviceId: 'd1' }, { configVersion: 2 })
  assert.equal(frame.frameId, 'f1', 'frame kind must map generic id to frameId')
  assert.equal(frame.pointId, '', 'frame evidence must never carry the frame id as pointId')
  const alarm = buildAgentRef('alarm', { id: 'a1', connectionId: 'c1' }, { configVersion: 2 })
  assert.equal(alarm.alarmId, 'a1', 'alarm kind must map generic id to alarmId')
  assert.equal(alarm.pointId, '')
})

test('Task4: buildAgentRef trend requires trendKey and backfills connection/device/point', async () => {
  const trend = buildAgentRef('trend', { trendKey: 'c1:d1:p1' }, { configVersion: 2 })
  assert.equal(trend.trendKey, 'c1:d1:p1', 'trend ref must carry trendKey')
  assert.equal(trend.connectionId, 'c1', 'trendKey must backfill connectionId')
  assert.equal(trend.deviceId, 'd1', 'trendKey must backfill deviceId')
  assert.equal(trend.pointId, 'p1', 'trendKey must backfill pointId')
  const withCtx = buildAgentRef('trend', { trendKey: 'c1:d1:p1', connectionId: 'c7' }, { configVersion: 2 })
  assert.equal(withCtx.connectionId, 'c7', 'explicit connectionId wins over backfill')
  assert.throws(
    () => buildAgentRef('trend', { trendKey: 'not-a-key' }),
    /trendKey/,
    'malformed trendKey must fail fast',
  )
})

test('Task4: evidenceFromRef emits the standard typed evidence shape', async () => {
  const ref = buildAgentRef(
    'frame',
    { frameId: 'f1', connectionId: 'c1', deviceId: 'd1' },
    { configVersion: 3, start: 100, end: 900 },
  )
  const ev = evidenceFromRef(ref)
  assert.equal(ev.kind, 'frame')
  assert.equal(ev.frameId, 'f1')
  assert.equal(ev.pointId, '')
  assert.equal(ev.id, 'f1')
  assert.equal(ev.version, 3)
  assert.deepEqual(ev.timeRange, { start: 100, end: 900 })
  const trend = evidenceFromRef(buildAgentRef('trend', { trendKey: 'c1:d1:p1' }, { configVersion: 3 }))
  assert.equal(trend.trendKey, 'c1:d1:p1')
  assert.equal(trend.pointId, 'p1')
})

test('Task4: appendEvidence resolves by kind — frame id validated as frame, not point', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-ev-contract-'))
  const cwd = join(home, 'board')
  try {
    const cv = await setup(home, cwd)
    // frame evidence given only a generic id must resolve against frames
    const r = await appendEvidence(home, cwd, {
      kind: 'frame',
      id: 'f1',
      connectionId: 'c1',
      deviceId: 'd1',
      at: 1000,
      version: cv,
    })
    assert.equal(r.ok, true, 'frame id must be validated as frame: ' + r.error)
    const stored = loadWorkspace(home, cwd).focus.evidence[0]
    assert.equal(stored.kind, 'frame')
    assert.equal(stored.frameId, 'f1')
    assert.equal(stored.pointId, '')
    // non-existent frame id -> TARGET_MISMATCH with frame wording, not point wording
    const bad = await appendEvidence(home, cwd, {
      kind: 'frame',
      id: 'nope',
      connectionId: 'c1',
      deviceId: 'd1',
      at: 1000,
      version: cv,
    })
    assert.equal(bad.ok, false)
    assert.match(bad.error, /报文不存在/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Task4: appendEvidence point/alarm/trend map to their own typed ids', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-ev-contract2-'))
  const cwd = join(home, 'board')
  try {
    const cv = await setup(home, cwd)
    const point = await appendEvidence(home, cwd, {
      kind: 'point',
      id: 'p1',
      connectionId: 'c1',
      deviceId: 'd1',
      at: 1000,
      version: cv,
    })
    assert.equal(point.ok, true)
    const alarm = await appendEvidence(home, cwd, {
      kind: 'alarm',
      id: 'a1',
      connectionId: 'c1',
      deviceId: 'd1',
      at: 1000,
      version: cv,
    })
    assert.equal(alarm.ok, true, 'alarm id must validate as alarm: ' + alarm.error)
    const trend = await appendEvidence(home, cwd, {
      kind: 'trend',
      id: 'c1:d1:p1',
      connectionId: 'c1',
      at: 1000,
      version: cv,
    })
    assert.equal(trend.ok, true, 'trend id must validate as trendKey: ' + trend.error)
    const ws = loadWorkspace(home, cwd)
    const by = (kind) => ws.focus.evidence.find((e) => e.kind === kind)
    assert.equal(by('point').pointId, 'p1')
    assert.equal(by('alarm').alarmId, 'a1')
    assert.equal(by('trend').trendKey, 'c1:d1:p1')
    assert.ok(by('trend').timeRange && Number.isFinite(by('trend').timeRange.start))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('Task4: normalizeFocusState keeps typed ids + timeRange and round-trips identically', async () => {
  const input = {
    request: null,
    prev: null,
    badgeOnly: false,
    evidence: [
      {
        kind: 'frame',
        id: 'f1',
        frameId: 'f1',
        connectionId: 'c1',
        deviceId: 'd1',
        at: 2000,
        version: 3,
        timeRange: { start: 100, end: 2000 },
      },
      { kind: 'trend', id: 'c1:d1:p1', trendKey: 'c1:d1:p1', connectionId: 'c1', at: 3000, version: 3 },
      { kind: 'point', id: 'p1', pointId: 'p1', connectionId: 'c1', deviceId: 'd1', at: 4000, version: 3 },
    ],
  }
  const n1 = normalizeFocusState(input)
  const frame = n1.evidence.find((e) => e.kind === 'frame')
  assert.equal(frame.frameId, 'f1')
  assert.equal(frame.pointId, '')
  assert.deepEqual(frame.timeRange, { start: 100, end: 2000 })
  const trend = n1.evidence.find((e) => e.kind === 'trend')
  assert.equal(trend.trendKey, 'c1:d1:p1')
  // restart-style round trip: normalize the normalized again -> identical
  const n2 = normalizeFocusState({ ...input, evidence: n1.evidence })
  assert.deepEqual(n2, n1, 'normalized focus state must be stable across restart')
})

test('Task4: postEvidence surfaces CONFIG_DRIFT / TARGET_MISMATCH instead of silent swallow', async () => {
  const ref = buildAgentRef('point', { pointId: 'p1', connectionId: 'c1', deviceId: 'd1' }, { configVersion: 7 })
  let surfaced = ''
  await postEvidence(
    async () => ({ ok: false, errorCode: 'CONFIG_DRIFT', error: '版本漂移：证据基于 v6 当前 v7' }),
    'board',
    evidenceFromRef(ref),
    (reason) => {
      surfaced = reason
    },
  )
  assert.match(surfaced, /CONFIG_DRIFT/)
  surfaced = ''
  await postEvidence(
    async () => ({ ok: false, errorCode: 'TARGET_MISMATCH', error: '点位不存在: xx' }),
    'board',
    evidenceFromRef(ref),
    (reason) => {
      surfaced = reason
    },
  )
  assert.match(surfaced, /TARGET_MISMATCH/)
  surfaced = ''
  await postEvidence(
    async () => {
      throw new Error('net down')
    },
    'board',
    evidenceFromRef(ref),
    (reason) => {
      surfaced = reason
    },
  )
  assert.match(surfaced, /net down/)
  // success path never calls onFail
  let called = false
  const ok = await postEvidence(
    async () => ({ ok: true }),
    'board',
    evidenceFromRef(ref),
    () => {
      called = true
    },
  )
  assert.equal(ok.ok, true)
  assert.equal(called, false)
})

test('Task4: UI evidence requests use explicit typed fields and no silent evidence swallow', async () => {
  const live =
    readFileSync(new URL('../src/ui/monitor/alarms/alarm-page.mjs', import.meta.url), 'utf8') +
    readFileSync(new URL('../src/ui/monitor/journal/journal-page.mjs', import.meta.url), 'utf8')
  const hmiRoot = join(dirname(fileURLToPath(import.meta.url)), '../src/ui/hmi')
  const hmi = readdirSync(hmiRoot)
    .filter((f) => f.endsWith('.mjs'))
    .map((f) => readFileSync(join(hmiRoot, f), 'utf8'))
    .join('\n')
  const frames = readFileSync(new URL('../src/ui/monitor/frames/frames-page.mjs', import.meta.url), 'utf8')
  // all three surfaces must go through the shared typed postEvidence helper
  assert.match(live, /postEvidence\(/)
  assert.match(hmi, /postEvidence\(/)
  assert.match(frames, /postEvidence\(/)
  // frames page sends the explicit frame contract
  assert.match(frames, /kind:\s*'frame'|evidenceFromRef/)
  // no silent .catch(() => {}) may swallow an evidence POST
  assert.ok(
    !/\/dsh-vision-bench\/evidence[^\n]*\n[^\n]*\.catch\(\(\)\s*=>\s*\{\}\)/.test(live + hmi + frames),
    'evidence failures must be surfaced, never silently caught',
  )
})

test('Task4: POST /evidence via host appends typed frame evidence and survives restart', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-ev-contract3-'))
  const cwd = join(home, 'board')
  try {
    const cv = await setup(home, cwd)
    const { runVisionBench } = await import('../bench-tool.mjs')
    const res = await runVisionBench(
      home,
      {
        action: 'evidence',
        evidence: [{ kind: 'frame', id: 'f1', connectionId: 'c1', deviceId: 'd1', at: 1000, version: cv }],
      },
      cwd,
      { source: 'user', sessionId: 's1' },
    )
    assert.equal(res.ok, true, 'host evidence must accept typed frame: ' + res.error)
    const again = await runVisionBench(home, { action: 'evidence' }, cwd, { source: 'user', sessionId: 's1' })
    assert.equal(again.ok, true)
    const ws = loadWorkspace(home, cwd)
    const frame = ws.focus.evidence.find((e) => e.kind === 'frame')
    assert.equal(frame && frame.frameId, 'f1')
    assert.equal(frame && frame.pointId, '')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
