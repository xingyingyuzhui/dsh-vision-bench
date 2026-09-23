import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { beforeEach } from 'node:test'
import { STANDARD_PRESET_SNAPSHOT_CONTRACT } from '../../src/infrastructure/harness/standard-preset-snapshot.mjs'
import {
  PRESET_ID,
  REBUILD_INSTRUCTIONS_DECLARATIVE,
  resetDeclarationState,
  setDeclarationState,
  userPresetDir,
} from '../../src/infrastructure/harness/preset-declaration.mjs'
import { inspectPresetHealth, seedVisionBenchPreset } from '../../src/infrastructure/harness/preset.mjs'

beforeEach(() => resetDeclarationState())

test('declarative health reports the registration, not a directory', async () => {
  setDeclarationState({
    mode: 'declarative',
    phase: 'registered',
    via: 'agentPresets.register',
    at: '2026-09-23T08:00:00.000Z',
    backupDir: '/home/.agent-presets/.vision-bench.backup.2026-09-23',
    migrationWarning: '',
  })
  const health = await inspectPresetHealth('/unused/home')
  assert.equal(health.ok, true)
  assert.equal(health.via, 'agentPresets.register')
  assert.equal(health.generation, '2026-09-23T08:00:00.000Z')
  assert.equal(health.appliesOnNewSession, true)
  assert.match(String(health.nextStep), /新建 Session/)
  assert.match(String(health.backupDir), /vision-bench\.backup/)
})

test('declarative health surfaces roster and registration failures with rebuild help', async () => {
  setDeclarationState({ mode: 'declarative', phase: 'failed', error: 'registry exploded' })
  const failed = await inspectPresetHealth('/unused/home')
  assert.equal(failed.ok, false)
  assert.match(String(failed.error), /registry exploded/)
  assert.equal(failed.nextStep, REBUILD_INSTRUCTIONS_DECLARATIVE)

  setDeclarationState({ mode: 'declarative', phase: 'pending' })
  const pending = await inspectPresetHealth('/unused/home')
  assert.equal(pending.ok, false)
  assert.match(String(pending.error), /注册中/)
  assert.equal(pending.nextStep, REBUILD_INSTRUCTIONS_DECLARATIVE)
})

test('declarative health warns but passes when only migration failed', async () => {
  setDeclarationState({
    mode: 'declarative',
    phase: 'registered',
    via: 'agentPresets.register',
    at: '2026-09-23T08:00:00.000Z',
    migrationWarning: '旧目录预设迁移失败：EPERM',
  })
  const health = await inspectPresetHealth('/unused/home')
  assert.equal(health.ok, true)
  assert.match(String(health.warning), /EPERM/)
})

test('declarative health warns when the standard snapshot predates the installed DSH', async () => {
  setDeclarationState({
    mode: 'declarative',
    phase: 'registered',
    via: 'agentPresets.register',
    at: '2026-09-23T08:00:00.000Z',
    migrationWarning: '旧目录预设迁移失败：EPERM',
  })
  const root = await mkdtemp(join(tmpdir(), 'dvb-dsh-ver-'))
  const pkgDir = join(root, 'node_modules', '@deepseek-ai', 'dsh')
  await mkdir(pkgDir, { recursive: true })
  await writeFile(join(pkgDir, 'package.json'), JSON.stringify({ name: '@deepseek-ai/dsh', version: '9.9.9' }))
  try {
    const health = await inspectPresetHealth('/unused/home', { dshPaths: [root] })
    assert.equal(health.ok, true)
    assert.match(
      String(health.warning),
      new RegExp(
        `标准预设快照（${STANDARD_PRESET_SNAPSHOT_CONTRACT.replaceAll('.', '\\.')}）早于已安装 DSH（9\\.9\\.9），如 roster 行 broken 请升级插件`,
      ),
    )
    assert.match(String(health.warning), /EPERM/)
  } finally {
    await rm(root, { recursive: true, force: true })
  }
})

test('legacy mode keeps the directory health contract', async () => {
  setDeclarationState({ mode: 'legacy' })
  const home = await mkdtemp(join(tmpdir(), 'dvb-health-'))
  const health = await inspectPresetHealth(home)
  assert.equal(health.ok, false)
  assert.match(String(health.error), /Vision预设尚未安装|无法解析|找不到/)
})

async function homeWithLegacyPreset() {
  const home = await mkdtemp(join(tmpdir(), 'dvb-seed-'))
  const dir = userPresetDir(home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), '- id: persona\n  name: persona\n')
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 3, basePresetId: 'standard', pluginRowId: 'vision-bench-tools' }),
  )
  return home
}

test('seed routes declarative registries to registration and hands back the disposer', async () => {
  const home = await homeWithLegacyPreset()
  /** @type {any[]} */
  const registered = []
  const registry = {
    async register(definition) {
      registered.push(definition)
      return async () => {}
    },
    async list() {
      return [{ id: PRESET_ID }]
    },
  }
  const out = await seedVisionBenchPreset(registry, home, { duplicateRetries: 0 })
  assert.equal(out.ok, true, out.error)
  assert.equal(out.via, 'agentPresets.register')
  assert.equal(typeof out.dispose, 'function')
  assert.equal(out.migrated, true)
  assert.equal(registered.length, 1)
  await readdir(userPresetDir(home)).then(
    () => assert.fail('legacy directory must be migrated away'),
    () => undefined,
  )
})

test('seed keeps writing the legacy directory on a legacy registry', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-seed-'))
  const standardDir = await mkdtemp(join(tmpdir(), 'dvb-standard-'))
  await writeFile(join(standardDir, 'agent.cordis.yml'), '- id: persona\n  name: "@deepseek-ai/dsh-persona"\n  config:\n    prefix: You are a coding agent\n')
  await writeFile(join(standardDir, 'preset.yml'), 'name: Standard\n')
  let copied = 0
  const registry = {
    async copy() {
      copied += 1
      throw Object.assign(new Error('already exists'), { code: 'agent-preset/invalid' })
    },
  }
  const out = await seedVisionBenchPreset(registry, home, { standardDir })
  assert.equal(out.ok, true, out.error)
  assert.equal(copied, 1)
  const entries = await readdir(userPresetDir(home))
  assert.ok(entries.includes('agent.cordis.yml'))
  await rm(home, { recursive: true, force: true })
  await rm(standardDir, { recursive: true, force: true })
})
