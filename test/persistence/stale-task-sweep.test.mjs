import assert from 'node:assert/strict'
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, normalizeWorkspace, saveWorkspace, sweepStaleTasks, workspaceKey } from '../../bench-store.mjs'
import { loadV4Workspace, workspaceDir } from '../../src/infrastructure/persistence/workspace-migration.mjs'
import { createWorkspaceRepository } from '../../src/infrastructure/persistence/workspace-repository.mjs'

const runningTask = (id = 't-run') => ({
  id,
  type: 'build',
  source: 'user',
  sessionId: '',
  status: 'running',
  startedAt: Date.now() - 5000,
  endedAt: null,
  summary: '编译',
})

const doneTask = (id = 't-ok') => ({
  id,
  type: 'read',
  source: 'user',
  sessionId: '',
  status: 'ok',
  startedAt: 1,
  endedAt: 2,
  summary: '读点完成',
})

async function withHome(fn) {
  const home = await mkdtemp(join(tmpdir(), 'dvb-sweep-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  try {
    return await fn(home, cwd)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
}

test('v4 running task becomes error and stays error after reload', async () => {
  await withHome(async (home, cwd) => {
    const saved = saveWorkspace(home, cwd, { tasks: [runningTask()] })
    assert.equal(saved.ok, true)
    const before = loadWorkspace(home, cwd)
    assert.equal(before.tasks[0].status, 'running')
    const cv = before.modbus.configVersion

    const ran = await sweepStaleTasks(home)
    assert.equal(ran.ok, true)
    assert.equal(ran.swept, 1)

    const after = loadWorkspace(home, cwd)
    assert.equal(after.tasks[0].status, 'error')
    assert.match(after.tasks[0].summary, /上次运行中断/)
    assert.equal(after.modbus.configVersion, cv)

    const dir = workspaceDir(home, workspaceKey(cwd))
    const v4 = loadV4Workspace(dir, normalizeWorkspace)
    assert.ok(v4)
    assert.equal(v4.tasks[0].status, 'error')
    assert.equal(v4.modbus.configVersion, cv)
  })
})

test('legacy workspace is swept and migrated', async () => {
  await withHome(async (home, cwd) => {
    const key = workspaceKey(cwd)
    const root = join(home, 'vision-bench', 'workspaces')
    mkdirSync(root, { recursive: true })
    const legacy = join(root, `${key}.json`)
    writeFileSync(
      legacy,
      JSON.stringify({
        keil: { project: '', target: '', artifact: 'hex' },
        modbus: { version: 3, configVersion: 4, connections: [], devices: [], points: [] },
        tasks: [runningTask('legacy-run')],
        timeline: [],
      }) + '\n',
    )
    assert.equal(existsSync(join(root, key, 'runtime.json')), false)

    const ran = await sweepStaleTasks(home)
    assert.equal(ran.ok, true)
    assert.equal(ran.swept, 1)

    const after = loadWorkspace(home, cwd)
    assert.equal(after.tasks[0].status, 'error')
    assert.equal(after.modbus.configVersion, 4)
    assert.equal(existsSync(join(root, key, 'runtime.json')), true)
    const runtime = JSON.parse(readFileSync(join(root, key, 'runtime.json'), 'utf8'))
    assert.equal(runtime.tasks[0].status, 'error')
  })
})

test('completed tasks are not swept', async () => {
  await withHome(async (home, cwd) => {
    saveWorkspace(home, cwd, { tasks: [doneTask(), runningTask()] })
    const ran = await sweepStaleTasks(home)
    assert.equal(ran.swept, 1)
    const after = loadWorkspace(home, cwd)
    const ok = after.tasks.find((t) => t.id === 't-ok')
    const failed = after.tasks.find((t) => t.id === 't-run')
    assert.equal(ok.status, 'ok')
    assert.equal(ok.summary, '读点完成')
    assert.equal(failed.status, 'error')
  })
})

test('configVersion is unchanged by sweep', async () => {
  await withHome(async (home, cwd) => {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [{ id: 'c1', name: 'C1', conn: { mode: 'tcp', host: '127.0.0.1', sim: true } }],
      },
      tasks: [runningTask()],
    })
    const before = loadWorkspace(home, cwd)
    const cv = before.modbus.configVersion
    assert.ok(cv >= 1)
    await sweepStaleTasks(home)
    const after = loadWorkspace(home, cwd)
    assert.equal(after.modbus.configVersion, cv)
    assert.equal(after.modbus.connections[0].id, 'c1')
  })
})

test('write failure does not report swept', async () => {
  await withHome(async (home, cwd) => {
    saveWorkspace(home, cwd, { tasks: [runningTask()] })
    const ran = await sweepStaleTasks(home, {
      persistWorkspace() {
        throw new Error('disk full')
      },
    })
    assert.equal(ran.ok, false)
    assert.equal(ran.swept, 0)
    assert.equal(ran.errors[0].errorCode, 'WORKSPACE_WRITE_FAILED')
    const after = loadWorkspace(home, cwd)
    assert.equal(after.tasks[0].status, 'running')
  })
})

test('repeat sweep is idempotent', async () => {
  await withHome(async (home, cwd) => {
    saveWorkspace(home, cwd, { tasks: [runningTask()] })
    const first = await sweepStaleTasks(home)
    assert.equal(first.swept, 1)
    const second = await sweepStaleTasks(home)
    assert.equal(second.ok, true)
    assert.equal(second.swept, 0)
    const after = loadWorkspace(home, cwd)
    assert.equal(after.tasks.filter((t) => t.status === 'error').length, 1)
  })
})

test('repository.listWorkspaceKeys sees v4 dirs and legacy files', async () => {
  await withHome(async (home, cwd) => {
    saveWorkspace(home, cwd, { tasks: [runningTask()] })
    const repo = createWorkspaceRepository({
      home,
      keyOf: workspaceKey,
      normalizeWorkspace,
    })
    const keys = repo.listWorkspaceKeys()
    assert.ok(keys.includes(workspaceKey(cwd)))
    const ran = await repo.sweepInterruptedTasks()
    assert.equal(ran.swept, 1)
  })
})
