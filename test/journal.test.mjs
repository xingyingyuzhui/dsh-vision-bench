import assert from 'node:assert/strict'
import { mkdir, rm, writeFile } from 'node:fs/promises'
import { mkdtemp } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { keilBuild } from '../bench-actions.mjs'
import {
  capTasks,
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
  const kept = compactTasks([{
    id: 'c',
    type: 'build',
    source: 'agent',
    sessionId: 's',
    status: 'error',
    startedAt: 1,
    endedAt: 2,
    summary: '编译失败',
    logFile: '/tmp/t.log',
    phase: 'compile',
    errors: ['main.c(12): error: foo'],
  }])[0]
  assert.equal(kept.logFile, '/tmp/t.log')
  assert.equal(kept.phase, 'compile')
  assert.deepEqual(kept.errors, ['main.c(12): error: foo'])
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
    await writeFile(project, '<Project/>')
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
    await writeFile(project, '<Project/>')
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
    await writeFile(project, '<Project/>')
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
    assert.ok(ran.result)
    assert.equal(typeof ran.result.summary, 'string')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('finishTask stores logFile, phase and errors for Agent builds', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-j-log-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const task = openTask(home, cwd, { type: 'build', source: 'agent', sessionId: 's', summary: '编译 Debug' })
    finishTask(home, cwd, task.id, {
      ok: false,
      summary: '编译失败 identifier foo',
      logFile: '/tmp/vision-bench/logs/t9.log',
      phase: 'compile',
      errors: ['main.c(12): error: #20: identifier "foo" is undefined'],
    })
    const ws = loadWorkspace(home, cwd)
    assert.equal(ws.tasks[0].status, 'error')
    assert.equal(ws.tasks[0].logFile, '/tmp/vision-bench/logs/t9.log')
    assert.equal(ws.tasks[0].phase, 'compile')
    assert.equal(ws.tasks[0].errors[0].includes('foo'), true)
    const view = journalView(ws)
    assert.equal(view.tasks[0].logFile, '/tmp/vision-bench/logs/t9.log')
    assert.deepEqual(view.tasks[0].errors, ws.tasks[0].errors)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('capTasks keeps running tasks across the recency cap', () => {
  const mk = (i, status) => ({ id: 't' + i, type: 'read', source: 'user', sessionId: '', status, startedAt: i, endedAt: null, summary: '' })
  const tasks = [mk('build', 'running')]
  for (let i = 0; i < 25; i++) tasks.push(mk(i, 'ok'))
  const capped = capTasks(tasks)
  assert.ok(capped.some((item) => item.id === 'tbuild' && item.status === 'running'))
  assert.ok(capped.length <= 21)
})

test('openTask never evicts a long-running build under read pressure', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-cap-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const buildTask = openTask(home, cwd, { type: 'build', source: 'agent', sessionId: 's', summary: '长编译' })
    for (let i = 0; i < 25; i++) {
      const t = openTask(home, cwd, { type: 'read', source: 'user', sessionId: '', summary: '读' + i })
      finishTask(home, cwd, t.id, { ok: true, summary: '完成' })
    }
    const ws = loadWorkspace(home, cwd)
    const stillRunning = ws.tasks.find((item) => item.id === buildTask.id)
    assert.ok(stillRunning, 'running build was evicted')
    assert.equal(stillRunning.status, 'running')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
