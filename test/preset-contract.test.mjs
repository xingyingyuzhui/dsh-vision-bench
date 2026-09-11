import assert from 'node:assert/strict'
import { mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { ensurePresetOverlay, seedVisionBenchPreset } from '../bench-preset.mjs'
import {
  SUPPORTED_DSH_CONTRACT,
  loadOfficialPersonaConfig,
  localPersonaConfigReplica,
} from '../src/infrastructure/harness/dsh-contract.mjs'
import { validatePersonaConfig } from '../src/infrastructure/harness/preset-validate.mjs'

const fixtureDir = dirname(fileURLToPath(import.meta.url))
const legacyFixture = join(fixtureDir, 'fixtures', 'legacy-vision-preset.yml')

async function ownedDir() {
  const dir = await mkdtemp(join(tmpdir(), 'dvb-contract-'))
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 2, pluginRowId: 'vision-bench-tools' }),
  )
  return dir
}

test('official dsh-persona Config rejects text-only and accepts prefix', async () => {
  const Config = await loadOfficialPersonaConfig()
  assert.equal(typeof Config, 'function')
  assert.throws(() => Config({ text: 'You are a coding agent' }), /prefix missing required value/)
  const ok = Config({ prefix: 'You are a coding agent' })
  assert.equal(ok.prefix, 'You are a coding agent')
  const replicaFail = () => localPersonaConfigReplica({ text: 'You are a coding agent' })
  assert.throws(replicaFail, /prefix missing required value/)
  assert.equal(SUPPORTED_DSH_CONTRACT, '0.1.5-rc.1')
})

test('real legacy preset migrates text→prefix and host row→/agent, then passes official Config', async () => {
  const Config = await loadOfficialPersonaConfig()
  const dir = await ownedDir()
  try {
    await writeFile(join(dir, 'agent.cordis.yml'), await readFile(legacyFixture, 'utf8'))
    const before = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    assert.match(before, /text:/)
    assert.match(before, /name: dsh-vision-bench\n/)
    assert.match(before, /role: agent/)
    assert.throws(
      () => validatePersonaConfig({ text: 'You are a coding agent powered by the {{model}} model.' }, Config),
      /prefix missing required value/,
    )

    const out = ensurePresetOverlay(dir, { personaConfig: Config })
    assert.equal(out.ok, true, out.error)
    const after = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
    assert.match(after, /name: dsh-vision-bench\/agent/)
    assert.doesNotMatch(after, /name: dsh-vision-bench\n/)
    assert.doesNotMatch(after, /role: agent/)
    const yaml = await import('yaml')
    const doc = yaml.parseDocument(after)
    let prefix
    let text
    for (const item of doc.contents.items) {
      if (item.get('id') === 'persona') {
        prefix = item.getIn(['config', 'prefix'])
        text = item.getIn(['config', 'text'])
      }
    }
    assert.equal(typeof prefix, 'string')
    assert.ok(prefix.includes('coding agent'))
    assert.equal(text, undefined)
    validatePersonaConfig({ prefix }, Config)

    const again = ensurePresetOverlay(dir, { personaConfig: Config })
    assert.equal(again.ok, true)
    assert.equal(again.unchanged, true)
    assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), after)
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})

test('fresh DSH_HOME copies shipped-standard fixture then passes official Config', async () => {
  const Config = await loadOfficialPersonaConfig()
  const home = await mkdtemp(join(tmpdir(), 'dvb-fresh-'))
  const standardDir = await mkdtemp(join(tmpdir(), 'dvb-standard-'))
  try {
    await writeFile(
      join(standardDir, 'agent.cordis.yml'),
      [
        '- id: persona',
        "  name: '@deepseek-ai/dsh-persona'",
        '  config:',
        '    prefix: >-',
        '      You are a coding agent powered by the {{model}} model.',
        '    suffix: Your working directory is {{cwd}}.',
        '',
      ].join('\n'),
    )
    await writeFile(join(standardDir, 'preset.yml'), 'name: 标准模式\n')
    const out = await seedVisionBenchPreset(null, home, {
      standardDir,
      personaConfig: Config,
    })
    assert.equal(out.ok, true, out.error)
    const composition = await readFile(join(home, '.agent-presets', 'vision-bench', 'agent.cordis.yml'), 'utf8')
    assert.match(composition, /prefix:/)
    assert.doesNotMatch(composition, /^\s+text:/m)
    assert.match(composition, /name: dsh-vision-bench\/agent/)
    const yaml = await import('yaml')
    const doc = yaml.parseDocument(composition)
    for (const item of doc.contents.items) {
      if (item.get('id') === 'persona') {
        validatePersonaConfig(item.get('config').toJSON(), Config)
      }
    }
  } finally {
    await rm(home, { recursive: true, force: true })
    await rm(standardDir, { recursive: true, force: true })
  }
})

test('seed without standard source fails instead of claiming success', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-nostandard-'))
  try {
    const out = await seedVisionBenchPreset(null, home, {
      standardDir: join(home, 'missing-standard'),
      personaConfig: localPersonaConfigReplica,
    })
    assert.equal(out.ok, false)
    assert.match(out.error, /找不到 DSH standard|复制/)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('conflicting prefix and text is diagnosed and keeps prefix', async () => {
  const dir = await ownedDir()
  try {
    await writeFile(
      join(dir, 'agent.cordis.yml'),
      [
        '- id: persona',
        "  name: '@deepseek-ai/dsh-persona'",
        '  config:',
        '    prefix: keep-this-prefix',
        '    text: different-user-text',
        '',
      ].join('\n'),
    )
    const out = ensurePresetOverlay(dir)
    assert.equal(out.ok, false)
    assert.equal(out.personaConflict, true)
    const yaml = await import('yaml')
    const doc = yaml.parseDocument(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'))
    let prefix
    let text
    for (const item of doc.contents.items) {
      if (item.get('id') === 'persona') {
        prefix = item.getIn(['config', 'prefix'])
        text = item.getIn(['config', 'text'])
      }
    }
    assert.equal(prefix, 'keep-this-prefix')
    assert.equal(text, 'different-user-text')
  } finally {
    await rm(dir, { recursive: true, force: true })
  }
})
