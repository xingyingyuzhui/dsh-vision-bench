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
  journalView,
  loadWorkspace,
  openTask,
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

test('trimTimeline keeps majors and drops oldest minors first', () => {
  const event = (i, kind) => ({ id: 'e' + i, at: i, kind, source: 'user', sessionId: '', taskId: '', ok: true, summary: '' })
  const events = []
  for (let i = 0; i < 200; i++) events.push(event(i, i % 10 === 0 ? 'build-end' : 'read-start'))
  const trimmed = trimTimeline(events)
  assert.ok(trimmed.length <= MAX_TIMELINE)
  const kinds = trimmed.map((item) => item.kind)
  assert.equal(kinds.filter((kind) => kind === 'build-end').length, 20)
  assert.ok(isMajorKind('write-end'))
  assert.ok(!isMajorKind('read-start'))
  const allMinor = trimTimeline(events.map((item) => ({ ...item, kind: 'read-start' })))
  assert.equal(allMinor.length, MAX_TIMELINE)
  assert.equal(allMinor[0].at, 80)
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
