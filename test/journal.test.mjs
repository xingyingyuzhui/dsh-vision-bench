import assert from 'node:assert/strict'
import { mkdir, rm } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { keilBuild } from '../bench-actions.mjs'
import {
  compactTasks,
  compactTimeline,
  normalizeOrigin,
  normalizeTask,
  normalizeTimelineEvent,
  runningTasks,
} from '../bench-journal.mjs'
import {
  finishTask,
  journalView,
  loadWorkspace,
  openTask,
  saveBindings,
  saveWorkspace,
} from '../bench-store.mjs'
import { runVisionBench, sessionIdOf } from '../bench-tool.mjs'

test('normalizeOrigin and task defaults', () => {
  assert.deepEqual(normalizeOrigin({ source: 'agent', sessionId: ' s1 ' }), {
    source: 'agent',
    sessionId: 's1',
  })
  assert.equal(normalizeOrigin(null).source, 'user')
  const task = normalizeTask({ type: 'read', source: 'agent', status: 'running', summary: 'x' })
  assert.equal(task.type, 'read')
  assert.equal(task.status, 'running')
  assert.equal(task.source, 'agent')
  assert.equal(normalizeTimelineEvent({ kind: 'build-start' }).ok, null)
})

test('compact helpers cap and keep running', () => {
  const tasks = [
    { id: 'a', type: 'build', source: 'agent', sessionId: 's', status: 'running', startedAt: 1, endedAt: null, summary: 'go' },
    { id: 'b', type: 'read', source: 'user', sessionId: '', status: 'ok', startedAt: 1, endedAt: 2, summary: 'done' },
  ]
  assert.equal(runningTasks(tasks).length, 1)
  assert.equal(compactTasks(tasks)[0].id, 'a')
  assert.equal(compactTimeline([{ id: 'e', at: 1, kind: 'build-end', source: 'user', sessionId: '', taskId: 'b', ok: true, summary: 'ok' }])[0].kind, 'build-end')
})

test('openTask and finishTask persist a shared journal', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-journal-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const project = join(cwd, 'app.uvprojx')
    saveWorkspace(home, cwd, { keil: { project, target: 'Debug' } })
    const task = openTask(home, cwd, {
      type: 'build',
      source: 'agent',
      sessionId: 'sess-1',
      summary: '编译 Debug',
    })
    const mid = loadWorkspace(home, cwd)
    assert.equal(mid.tasks[0].id, task.id)
    assert.equal(mid.tasks[0].status, 'running')
    assert.equal(mid.timeline[0].kind, 'build-start')
    assert.equal(mid.timeline[0].source, 'agent')
    assert.equal(journalView(mid).running.length, 1)

    finishTask(home, cwd, task.id, { ok: true, summary: '编译成功', keil: { download: join(cwd, 'app.hex') } })
    const done = loadWorkspace(home, cwd)
    assert.equal(done.tasks[0].status, 'ok')
    assert.equal(done.keil.download, join(cwd, 'app.hex'))
    assert.equal(done.log[0].action, 'build')
    assert.ok(done.timeline.some((item) => item.kind === 'build-end'))
    assert.equal(journalView(done).running.length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('vision_bench status exposes tasks and agent origin marks select', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-tool-j-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const project = join(cwd, 'app.uvprojx')
    const selected = await runVisionBench(home, { action: 'select', path: project }, cwd, {
      source: 'agent',
      sessionId: 'sess-9',
    })
    assert.equal(selected.ok, true)
    assert.equal(selected.source, 'agent')
    const status = await runVisionBench(home, { action: 'status' }, cwd)
    assert.equal(status.ok, true)
    assert.ok(Array.isArray(status.tasks))
    assert.ok(Array.isArray(status.running))
    assert.ok(status.timeline.some((item) => item.kind === 'select-project' && item.source === 'agent'))
    assert.equal(sessionIdOf({ session: { header: { id: 'abc', cwd } } }), 'abc')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('keilBuild rejects a second running build and keeps the first task', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-build-j-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const python = process.execPath
    saveBindings(home, { python, uv4: python, openocd: '' })
    const project = join(cwd, 'app.uvprojx')
    saveWorkspace(home, cwd, { keil: { project, target: 'Debug' } })
    const task = openTask(home, cwd, { type: 'build', source: 'agent', sessionId: 'sess-2', summary: '编译 Debug' })
    const blocked = await keilBuild(home, cwd, { source: 'user', sessionId: 'ui' })
    assert.equal(blocked.ok, false)
    assert.match(blocked.error, /进行中/)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.tasks[0].id, task.id)
    assert.equal(ws.tasks[0].status, 'running')
    assert.equal(ws.tasks[0].source, 'agent')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('keilBuild records agent source when the compile itself fails', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-build-agent-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveBindings(home, { python: process.execPath, uv4: process.execPath, openocd: '' })
    const project = join(cwd, 'app.uvprojx')
    saveWorkspace(home, cwd, { keil: { project, target: 'Debug' } })
    const ran = await keilBuild(home, cwd, { source: 'agent', sessionId: 'sess-8' })
    assert.equal(ran.ok, false)
    assert.equal(ran.source, 'agent')
    assert.ok(ran.taskId)
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.tasks[0].id, ran.taskId)
    assert.equal(ws.tasks[0].source, 'agent')
    assert.equal(ws.tasks[0].sessionId, 'sess-8')
    assert.equal(ws.tasks[0].status, 'error')
    assert.ok(ws.timeline.some((item) => item.kind === 'build-start' && item.source === 'agent'))
    assert.ok(ws.timeline.some((item) => item.kind === 'build-end' && item.ok === false))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
