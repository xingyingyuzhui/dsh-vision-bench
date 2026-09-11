import assert from 'node:assert/strict'
import { existsSync, mkdirSync, writeFileSync } from 'node:fs'
import { mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { loadWorkspace, normalizeWorkspace, saveWorkspace, workspaceKey } from '../../bench-store.mjs'
import { readJsonSync, writeJsonAtomicSync } from '../../src/infrastructure/persistence/atomic-json.mjs'
import { runExclusive } from '../../src/infrastructure/persistence/workspace-lock.mjs'
import {
  legacyWorkspaceFile,
  loadV4Workspace,
  mergeWorkspaceParts,
  migrateLegacyWorkspace,
  splitWorkspaceParts,
  workspaceDir,
} from '../../src/infrastructure/persistence/workspace-migration.mjs'
import { createWorkspaceRepository } from '../../src/infrastructure/persistence/workspace-repository.mjs'

test('atomic-write: writes JSON that can be re-read', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-atom-'))
  const file = join(dir, 'x.json')
  writeJsonAtomicSync(file, { a: 1, b: 'ok' })
  assert.deepEqual(readJsonSync(file), { a: 1, b: 'ok' })
  await rm(dir, { recursive: true, force: true })
})

test('runtime persist can write compact JSON without fsync', async () => {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-atom-rt-'))
  const file = join(dir, 'runtime.json')
  writeJsonAtomicSync(file, { values: [1, 2], nested: { a: true } }, { pretty: false, fsync: false })
  const raw = (await import('node:fs')).readFileSync(file, 'utf8')
  assert.equal(raw.includes('\n  '), false)
  assert.deepEqual(readJsonSync(file), { values: [1, 2], nested: { a: true } })
  await rm(dir, { recursive: true, force: true })
})

test('concurrent-update: exclusive queue serializes mutators', async () => {
  const order = []
  const p1 = runExclusive('k', async () => {
    order.push('a-start')
    await new Promise((r) => setTimeout(r, 30))
    order.push('a-end')
    return 1
  })
  const p2 = runExclusive('k', async () => {
    order.push('b-start')
    order.push('b-end')
    return 2
  })
  const [r1, r2] = await Promise.all([p1, p2])
  assert.equal(r1, 1)
  assert.equal(r2, 2)
  assert.deepEqual(order, ['a-start', 'a-end', 'b-start', 'b-end'])
})

test('migration-v3-v4: legacy file migrates with backup and loads via v4', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-mig-'))
  const cwd = join(home, 'proj')
  mkdirSync(cwd)
  const key = workspaceKey(cwd)
  const legacy = legacyWorkspaceFile(home, key)
  mkdirSync(join(home, 'vision-bench', 'workspaces'), { recursive: true })
  writeFileSync(
    legacy,
    JSON.stringify({
      keil: { project: 'a.uvprojx', target: 'Target 1', artifact: 'hex' },
      modbus: {
        version: 3,
        configVersion: 2,
        connections: [
          { id: 'c1', name: 'C1', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM3', sim: true } },
        ],
        devices: [{ id: 'd1', connectionId: 'c1', name: 'Dev', unitId: 1 }],
        points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T', function: 3, address: 0 }],
        values: [{ key: 'p1', pointId: 'p1', value: 1, ok: true, at: 1 }],
      },
    }) + '\n',
  )
  const mig = migrateLegacyWorkspace(home, key, normalizeWorkspace)
  assert.equal(mig.ok, true)
  assert.ok(existsSync(legacy + '.pre-v4.bak'))
  const loaded = loadV4Workspace(workspaceDir(home, key), normalizeWorkspace)
  assert.ok(loaded)
  assert.equal(loaded.modbus.configVersion, 2)
  assert.equal(loaded.modbus.points.length, 1)
  assert.equal(loaded.modbus.values.length, 1)
  await rm(home, { recursive: true, force: true })
})

test('workspace-isolation: different keys do not share config', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-iso-'))
  const a = join(home, 'a')
  const b = join(home, 'b')
  mkdirSync(a)
  mkdirSync(b)
  saveWorkspace(home, a, {
    modbus: {
      version: 3,
      connections: [
        { id: 'c1', name: 'Alpha', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM1', sim: true } },
      ],
      devices: [],
      points: [],
    },
  })
  saveWorkspace(home, b, {
    modbus: {
      version: 3,
      connections: [
        { id: 'c1', name: 'Beta', role: 'client', enabled: true, conn: { mode: 'rtu', port: 'COM2', sim: true } },
      ],
      devices: [],
      points: [],
    },
  })
  const wa = loadWorkspace(home, a)
  const wb = loadWorkspace(home, b)
  assert.equal(wa.modbus.connections[0].name, 'Alpha')
  assert.equal(wb.modbus.connections[0].name, 'Beta')
  assert.notEqual(workspaceKey(a), workspaceKey(b))
  await rm(home, { recursive: true, force: true })
})

test('crash-recovery: corrupt v4 without marker falls back to legacy', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-crash-'))
  const cwd = join(home, 'p')
  mkdirSync(cwd)
  const key = workspaceKey(cwd)
  const legacy = legacyWorkspaceFile(home, key)
  mkdirSync(join(home, 'vision-bench', 'workspaces'), { recursive: true })
  writeFileSync(legacy, JSON.stringify({ modbus: { version: 3, points: [], connections: [], devices: [] } }) + '\n')
  const dir = workspaceDir(home, key)
  mkdirSync(dir, { recursive: true })
  writeFileSync(join(dir, 'config.json'), '{bad', 'utf8')
  const repo = createWorkspaceRepository({ home, keyOf: workspaceKey, normalizeWorkspace })
  const ws = repo.load(cwd)
  assert.equal(ws.modbus.version, 3)
  assert.ok(existsSync(legacy))
  await rm(home, { recursive: true, force: true })
})
test('split/merge workspace parts round-trips config vs runtime', async () => {
  const ws = normalizeWorkspace({
    keil: { project: 'p.uvprojx' },
    modbus: {
      version: 3,
      configVersion: 9,
      connections: [],
      devices: [],
      points: [{ id: 'p1', name: 'n', function: 3, address: 0 }],
      values: [{ key: 'p1', value: 3, ok: true }],
      alarmState: { p1: { condition: 'active' } },
    },
  })
  const parts = splitWorkspaceParts(ws)
  assert.ok(parts.config.modbus.points.length === 1)
  assert.equal(parts.config.modbus.values, undefined)
  assert.ok(parts.runtime.modbus.values.length === 1)
  const merged = mergeWorkspaceParts(parts.config, parts.runtime)
  assert.equal(merged.modbus.configVersion, 9)
  assert.equal(merged.modbus.values[0].value, 3)
})

test('repository update rejects configVersion drift', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-repo-'))
  const cwd = join(home, 'board')
  mkdirSync(cwd)
  saveWorkspace(home, cwd, { modbus: { version: 3, configVersion: 5, connections: [], devices: [], points: [] } })
  const repo = createWorkspaceRepository({ home, keyOf: workspaceKey, normalizeWorkspace })
  const drifted = await repo.update(cwd, 4, async (cur) => ({ workspace: cur }))
  assert.equal(drifted.ok, false)
  assert.equal(drifted.errorCode, 'CONFIG_DRIFT')
  await rm(home, { recursive: true, force: true })
})
