import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  MAX_TIMELINE,
  isMajorKind,
  isTaskType,
  normalizeTask,
  taskTypeLabel,
  trimTimeline,
} from '../bench-journal.mjs'
import {
  bindSession,
  createManualRequest,
  journalView,
  loadWorkspace,
  openTask,
  resolveManualRequest,
  unbindSession,
} from '../bench-store.mjs'
import { notifyBenchEvent, setAgentsRegistry, _internal } from '../bench-notify.mjs'

test('task type registry accepts reserved types and rejects unknown ones', () => {
  assert.equal(isTaskType('download'), true)
  assert.equal(isTaskType('verify'), true)
  assert.equal(isTaskType('write'), true)
  assert.equal(isTaskType('deploy'), false)
  assert.equal(taskTypeLabel('download'), '下载')
  const task = normalizeTask({ type: 'verify', status: 'running', stage: 'await-device', progress: 40 })
  assert.equal(task.type, 'verify')
  assert.equal(task.stage, 'await-device')
  assert.equal(task.progress, 40)
  const clamped = normalizeTask({ type: 'build', status: 'running', progress: 250 })
  assert.equal(clamped.progress, null)
})

test('trimTimeline keeps newest events and drops oldest minors first', () => {
  // Timeline is stored newest-first: index 0 is the most recent event.
  const event = (i, kind) => ({ id: 'e' + i, at: i, kind, source: 'user', sessionId: '', taskId: '', ok: true, summary: '' })
  const events = []
  for (let i = 199; i >= 0; i--) {
    // Push oldest first so the array ends up newest-first like prepend().
    // Every 10th timestamp is a major build-end.
    events.push(event(i, i % 10 === 0 ? 'build-end' : 'read-start'))
  }
  const trimmed = trimTimeline(events)
  // Newest window (120) plus rescued majors from older history (bounded by
  // another 120) — never unbounded growth.
  assert.ok(trimmed.length <= MAX_TIMELINE * 2)
  // The very newest event must survive.
  assert.equal(trimmed[0].at, 199)
  // All 20 majors survive: 12 inside the newest-120 window, 8 rescued from
  // older history.
  assert.equal(trimmed.filter((item) => item.kind === 'build-end').length, 20)
  // The OLDEST major (at 0, far outside the window) is rescued, not dropped.
  assert.ok(trimmed.some((item) => item.kind === 'build-end' && item.at === 0))
  // Newest minor right after the newest major must also survive.
  assert.ok(trimmed.slice(0, 5).some((item) => item.kind === 'read-start'))
  assert.ok(isMajorKind('write-end'))
  assert.ok(!isMajorKind('read-start'))

  const allMinor = trimTimeline(events.map((item) => ({ ...item, kind: 'read-start' })))
  assert.equal(allMinor.length, MAX_TIMELINE)
  // Newest-first kept the NEWEST 120 minors (at 199 down to 80).
  assert.equal(allMinor[0].at, 199)
  assert.equal(allMinor[allMinor.length - 1].at, 80)

  // Once full, fresh minor events must not be evicted in favour of old ones:
  // simulate a saturated list and prepend a brand-new minor.
  const saturated = allMinor
  const fresh = { id: 'fresh', at: 500, kind: 'read-start', source: 'user', sessionId: '', taskId: '', ok: true, summary: '' }
  const after = trimTimeline([fresh].concat(saturated))
  assert.equal(after[0].id, 'fresh')
})

test('bindSession and unbindSession persist the bound session id', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-bind-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const missing = await bindSession(home, cwd, '')
    assert.equal(missing.ok, false)
    const bound = await bindSession(home, cwd, 'sess-a')
    assert.equal(bound.ok, true)
    assert.equal(bound.prevBoundId, '')
    assert.equal(loadWorkspace(home, cwd).session.boundId, 'sess-a')
    const rebound = await bindSession(home, cwd, 'sess-b')
    assert.equal(rebound.prevBoundId, 'sess-a')
    const off = await unbindSession(home, cwd)
    assert.equal(off.ok, true)
    assert.equal(loadWorkspace(home, cwd).session.boundId, '')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('notifyBenchEvent only delivers to the bound live agent', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-notify-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const delivered = []
    const registry = {
      get(id) {
        if (id !== 'sess-live') return null
        return {
          followup(message) {
            delivered.push({ to: id, message })
            return Promise.resolve()
          },
        }
      },
    }
    setAgentsRegistry(registry)
    const skipped = await notifyBenchEvent(home, cwd, '台架编译失败')
    assert.equal(skipped.skipped, 'unbound')
    await bindSession(home, cwd, 'sess-idle')
    const miss = await notifyBenchEvent(home, cwd, '台架编译失败')
    assert.equal(miss.skipped, 'agent-missing')
    await bindSession(home, cwd, 'sess-live')
    const ran = await notifyBenchEvent(home, cwd, '台架写点失败', '回读不一致')
    assert.equal(ran.ok, true)
    assert.equal(delivered.length, 1)
    const message = delivered[0].message
    assert.equal(message.source.plugin, 'dsh-vision-bench')
    assert.equal(message.source.form, 'notice')
    assert.match(message.content[0].text, /台架写点失败/)
    setAgentsRegistry(null)
    const none = await notifyBenchEvent(home, cwd, 'x')
    assert.equal(none.skipped, 'no-registry')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('openTask accepts reserved types into the shared journal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-reserve-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const task = openTask(home, cwd, { type: 'download', source: 'agent', sessionId: 's', summary: '下载固件' })
    assert.equal(task.type, 'download')
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.tasks[0].type, 'download')
    assert.ok(ws.timeline.some((item) => item.kind === 'download-start'))
    assert.equal(journalView(ws).running.length, 1)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('notice builder falls back to a literal plugin-source message', async () => {
  const message = await _internal.buildMessage('正文', '摘要')
  assert.equal(message.role, 'user')
  assert.equal(message.content[0].type, 'text')
  assert.equal(message.content[0].text, '正文')
  assert.equal(message.source.kind, 'plugin')
  assert.equal(message.source.form, 'notice')
  assert.equal(message.source.summary, '摘要')
})

test('manual requests persist, resolve and notify', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-manual-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const missing = createManualRequest(home, cwd, { text: '' })
    assert.equal(missing.ok, false)
    const created = createManualRequest(home, cwd, { text: '请断电后重新上电', sessionId: 's1', source: 'agent' })
    assert.equal(created.ok, true)
    let ws = loadWorkspace(home, cwd)
    assert.equal(ws.manualRequests.length, 1)
    assert.equal(ws.manualRequests[0].status, 'pending')
    assert.ok(ws.timeline.some((item) => item.kind === 'manual-request'))
    const again = resolveManualRequest(home, cwd, 'nope', true)
    assert.equal(again.ok, false)
    const done = resolveManualRequest(home, cwd, created.request.id, true)
    assert.equal(done.ok, true)
    assert.equal(done.request.status, 'done')
    ws = loadWorkspace(home, cwd)
    assert.equal(ws.manualRequests[0].status, 'done')
    assert.ok(ws.timeline.some((item) => item.kind === 'manual-done' && item.ok === true))
    const twice = resolveManualRequest(home, cwd, created.request.id, false)
    assert.equal(twice.ok, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('explicit origin sessionId wins over the workspace binding', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-notify-orig-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const delivered = []
    const registry = {
      get(id) {
        if (id !== 'sess-origin') return null
        return { followup(message) { delivered.push({ to: id, message }); return Promise.resolve() } }
      },
    }
    setAgentsRegistry(registry)
    await bindSession(home, cwd, 'sess-other')
    const ran = await notifyBenchEvent(home, cwd, '写点完成', '', { sessionId: 'sess-origin' })
    assert.equal(ran.ok, true)
    assert.equal(delivered.length, 1)
    assert.equal(delivered[0].to, 'sess-origin')
    // Without an explicit origin the binding stays the default target.
    setAgentsRegistry({
      get(id) {
        if (id !== 'sess-other') return null
        return { followup() { return Promise.resolve() } }
      },
    })
    const fallback = await notifyBenchEvent(home, cwd, '台架告警')
    assert.equal(fallback.ok, true)
    assert.equal(fallback.boundId, 'sess-other')
    // Explicit origin that no longer exists is reported as missing, never
    // silently rerouted to the bound session.
    setAgentsRegistry({
      get(id) {
        if (id !== 'sess-other') return null
        return { followup() { return Promise.resolve() } }
      },
    })
    const miss = await notifyBenchEvent(home, cwd, 'x', '', { sessionId: 'sess-gone' })
    assert.equal(miss.skipped, 'agent-missing')
    setAgentsRegistry(null)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
