import assert from 'node:assert/strict'
import { mkdir, mkdtemp, readdir, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test, { beforeEach } from 'node:test'
import {
  PRESET_ID,
  activateVisionPresetDeclaration,
  getDeclarationState,
  migrateLegacyPresetDir,
  registerVisionPreset,
  resetDeclarationState,
  userPresetDir,
} from '../../src/infrastructure/harness/preset-declaration.mjs'

/**
 * @param {{ failWith?: Error, failCalls?: (call: number) => boolean, rows?: any[] }} [options]
 */
function stubRegistry(options = {}) {
  const state = { calls: 0, registered: /** @type {any[]} */ ([]), disposed: 0 }
  return {
    state,
    /** @param {any} definition */
    async register(definition) {
      state.calls += 1
      if (options.failWith && (!options.failCalls || options.failCalls(state.calls))) throw options.failWith
      state.registered.push(definition)
      return async () => {
        state.disposed += 1
      }
    },
    async list() {
      return options.rows ?? [{ id: PRESET_ID, name: 'Vision模式' }]
    },
  }
}

async function homeWithLegacyPreset(markerText) {
  const home = await mkdtemp(join(tmpdir(), 'dvb-decl-'))
  const dir = userPresetDir(home)
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), '- id: persona\n  name: persona\n')
  await writeFile(join(dir, 'preset.yml'), 'name: Vision模式\n')
  if (markerText !== undefined) await writeFile(join(dir, '.dsh-vision-bench'), markerText)
  return home
}

const OWNED_MARKER = JSON.stringify({
  owner: 'dsh-vision-bench',
  presetSchemaVersion: 3,
  basePresetId: 'standard',
  pluginRowId: 'vision-bench-tools',
})

beforeEach(() => resetDeclarationState())

test('registerVisionPreset registers the vision definition and returns its disposer', async () => {
  const registry = stubRegistry()
  const result = await registerVisionPreset(registry, { platform: 'linux', duplicateRetries: 0 })
  assert.equal(result.ok, true)
  assert.equal(result.via, 'agentPresets.register')
  assert.equal(typeof result.dispose, 'function')
  assert.equal(registry.state.registered[0].id, PRESET_ID)
  await result.dispose()
  assert.equal(registry.state.disposed, 1)
})

test('registerVisionPreset reports registration failures', async () => {
  const registry = stubRegistry({ failWith: new Error('registry exploded') })
  const result = await registerVisionPreset(registry, { duplicateRetries: 0 })
  assert.equal(result.ok, false)
  assert.match(String(result.error), /registry exploded/)
  assert.equal(result.dispose, null)
})

test('registerVisionPreset retries a taken id before giving up', async () => {
  const registry = stubRegistry({
    failWith: new Error('Duplicate agent preset: vision-bench'),
    failCalls: (call) => call === 1,
  })
  const result = await registerVisionPreset(registry, { retryDelayMs: 0 })
  assert.equal(result.ok, true)
  assert.equal(result.via, 'agentPresets.register')
  assert.equal(registry.state.calls, 2)
})

test('registerVisionPreset defers to an external declaration owning the id', async () => {
  const registry = stubRegistry({
    failWith: new Error('Duplicate agent preset: vision-bench'),
    failCalls: () => true,
  })
  const result = await registerVisionPreset(registry, { duplicateRetries: 0 })
  assert.equal(result.ok, true)
  assert.equal(result.via, 'external-declaration')
  assert.equal(result.delegated, true)
  assert.equal(result.dispose, null)
})

test('migrateLegacyPresetDir renames an owned directory into a backup', async () => {
  const home = await homeWithLegacyPreset(OWNED_MARKER)
  const out = migrateLegacyPresetDir(home)
  assert.equal(out.ok, true, out.error)
  assert.equal(out.migrated, true)
  const entries = await readdir(join(home, '.agent-presets'))
  assert.ok(entries.includes('.vision-bench.backup.' + String(out.backupDir).split('.vision-bench.backup.')[1]))
  assert.ok(!entries.includes(PRESET_ID))
  const backed = await readFile(join(String(out.backupDir), 'agent.cordis.yml'), 'utf8')
  assert.match(backed, /persona/)
})

test('migrateLegacyPresetDir accepts the legacy plain-string marker', async () => {
  const home = await homeWithLegacyPreset('dsh-vision-bench')
  const out = migrateLegacyPresetDir(home)
  assert.equal(out.ok, true, out.error)
  assert.equal(out.migrated, true)
})

test('migrateLegacyPresetDir never touches a foreign or unmarked directory', async () => {
  const foreign = await homeWithLegacyPreset(JSON.stringify({ owner: 'someone-else' }))
  const foreignOut = migrateLegacyPresetDir(foreign)
  assert.equal(foreignOut.ok, false)
  assert.match(String(foreignOut.error), /已被其他预设占用/)
  assert.deepEqual(await readdir(userPresetDir(foreign)), ['.dsh-vision-bench', 'agent.cordis.yml', 'preset.yml'])

  const unmarked = await homeWithLegacyPreset(undefined)
  const unmarkedOut = migrateLegacyPresetDir(unmarked)
  assert.equal(unmarkedOut.ok, false)
  assert.match(String(unmarkedOut.error), /已被其他预设占用/)
  assert.deepEqual(await readdir(userPresetDir(unmarked)), ['agent.cordis.yml', 'preset.yml'])
})

test('migrateLegacyPresetDir is a no-op without a legacy directory', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-decl-'))
  const out = migrateLegacyPresetDir(home)
  assert.equal(out.ok, true)
  assert.equal(out.migrated, false)
})

test('activateVisionPresetDeclaration registers, verifies the roster and migrates', async () => {
  const home = await homeWithLegacyPreset(OWNED_MARKER)
  const registry = stubRegistry()
  const activation = await activateVisionPresetDeclaration(registry, home, { duplicateRetries: 0 })
  assert.equal(activation.ok, true, activation.error)
  assert.equal(activation.via, 'agentPresets.register')
  assert.equal(typeof activation.dispose, 'function')
  assert.equal(activation.migration.migrated, true)
  const state = getDeclarationState()
  assert.equal(state.mode, 'declarative')
  assert.equal(state.phase, 'registered')
  assert.equal(state.error, '')
  assert.equal(state.backupDir, activation.migration.backupDir)
  await readdir(userPresetDir(home)).then(
    () => assert.fail('legacy directory must be gone'),
    () => undefined,
  )
})

test('activateVisionPresetDeclaration keeps the legacy directory when the roster row is broken', async () => {
  const home = await homeWithLegacyPreset(OWNED_MARKER)
  const registry = stubRegistry({ rows: [{ id: PRESET_ID, broken: 'row 3 names no plugin' }] })
  const activation = await activateVisionPresetDeclaration(registry, home, { duplicateRetries: 0 })
  assert.equal(activation.ok, false)
  assert.match(String(activation.error), /row 3 names no plugin/)
  assert.equal(activation.migration.migrated, false)
  assert.deepEqual(await readdir(userPresetDir(home)), ['.dsh-vision-bench', 'agent.cordis.yml', 'preset.yml'])
  assert.equal(getDeclarationState().phase, 'registered')
  assert.match(getDeclarationState().error, /row 3 names no plugin/)
})

test('activateVisionPresetDeclaration records registration failures', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-decl-'))
  const registry = stubRegistry({ failWith: new Error('registry exploded') })
  const activation = await activateVisionPresetDeclaration(registry, home, { duplicateRetries: 0 })
  assert.equal(activation.ok, false)
  assert.equal(getDeclarationState().phase, 'failed')
  assert.match(getDeclarationState().error, /registry exploded/)
})

test('activateVisionPresetDeclaration reports a missing roster row', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-decl-'))
  const registry = stubRegistry({ rows: [{ id: 'standard' }] })
  const activation = await activateVisionPresetDeclaration(registry, home, { duplicateRetries: 0 })
  assert.equal(activation.ok, false)
  assert.match(String(activation.error), /roster 缺少 vision-bench 声明/)
})
