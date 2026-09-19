import assert from 'node:assert/strict'
import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import {
  AGENT_PLUGIN_SPEC,
  PRESET_PERSONA,
  _internal,
  ensurePresetOverlay,
  inspectPresetHealth,
  parseCompositionDocument,
  seedVisionBenchPreset,
} from '../../bench-preset.mjs'
import { createTempDir } from '../helpers/workspace-factory.mjs'
import { LEGACY_PERSONA_A, personaComposition, trackBackup, withFsPatched } from '../helpers/preset-fixtures.mjs'

test('ensurePresetOverlay renames legacy host-named agent row to /agent', async (t) => {
  const dir = await createTempDir(t, 'dvb-preset-rename-')
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    ['- id: vision-bench-tools', '  name: dsh-vision-bench', '  config:', '    role: agent', ''].join('\n'),
  )
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 2, pluginRowId: 'vision-bench-tools' }),
  )
  const out = ensurePresetOverlay(dir)
  assert.equal(out.ok, true, out.error)
  const text = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.match(text, /name: dsh-vision-bench\/agent/)
  assert.doesNotMatch(text, /name: dsh-vision-bench\n/)
})

test('ensurePresetOverlay appends the agent-plane row and persona', async (t) => {
  const dir = await createTempDir(t, 'dvb-preset-')
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    text: >-',
      '      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.',
      '',
    ].join('\n'),
  )
  const out = ensurePresetOverlay(dir)
  assert.equal(out.ok, true)
  const text = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.match(text, /id: vision-bench-tools/)
  assert.match(text, /name: dsh-vision-bench\/agent/)
  assert.doesNotMatch(text, /role: agent/)
  assert.equal(AGENT_PLUGIN_SPEC, 'dsh-vision-bench/agent')
  // persona should remain standard (not Vision) – check via yaml parse to handle folded style
  const yaml = await import('yaml')
  const doc = yaml.parseDocument(text)
  let personaPrefix = null
  let personaText = null
  for (const item of doc.contents.items) {
    if (item.get('id') === 'persona') {
      personaPrefix = item.getIn(['config', 'prefix'])
      personaText = item.getIn(['config', 'text'])
    }
  }
  assert.equal(personaPrefix, PRESET_PERSONA)
  assert.equal(personaText, undefined)
  // Vision guidance is now via host prompt section, not hard-coded persona
  assert.equal(text.includes('Vision 台架'), false)
  // ownership file should be JSON with Vision模式 metadata
  const presetText = await readFile(join(dir, 'preset.yml'), 'utf8')
  assert.match(presetText, /^name: Vision模式$/m)
  const marker = await readFile(join(dir, '.dsh-vision-bench'), 'utf8')
  const ownership = JSON.parse(marker)
  assert.equal(ownership.owner, 'dsh-vision-bench')
  assert.equal(ownership.presetSchemaVersion, 3)
  assert.equal(ownership.pluginRowId, 'vision-bench-tools')
  assert.match(presetText, /Vision 调试与上位机接口/)
  assert.equal(presetText.includes('Vision 台架接口'), false)
})
test('overlay keeps Cordis !!js tags, never evals them, and migrates to Vision模式', async (t) => {
  const dir = await createTempDir(t, 'dvb-js-tag-')
  const jsLine = "disabled: !!js process.platform === 'win32'"
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    [
      '- id: extra',
      '  name: extra-row',
      '  ' + jsLine,
      '- id: persona',
      '  name: x',
      '  config:',
      '    text: >-',
      '      ' + LEGACY_PERSONA_A,
      '',
    ].join('\n'),
  )
  await writeFile(join(dir, 'preset.yml'), 'name: 台架模式\n')
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 1 }),
  )
  const bare = (await import('yaml')).parseDocument(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'))
  assert.ok(bare.warnings.some((item) => /Unresolved tag: tag:yaml.org,2002:js/.test(String(item))))
  const out = ensurePresetOverlay(dir)
  assert.equal(out.ok, true, out.error)
  const after = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.match(after, /disabled: !!js process\.platform === 'win32'/)
  assert.doesNotMatch(after, /disabled: (true|false)\b/)
  const parsed = parseCompositionDocument(after)
  assert.equal(parsed.errors.length, 0)
  assert.equal(parsed.warnings.length, 0)
  const presetText = await readFile(join(dir, 'preset.yml'), 'utf8')
  assert.match(presetText, /^name: Vision模式$/m)
  assert.equal(after.includes('Vision 台架'), false)
  assert.equal(_internal.CORDIS_JS_TAG.tag, 'tag:yaml.org,2002:js')
})
test('inspectPresetHealth reports generation and new-session apply rule', async (t) => {
  const dir = await createTempDir(t, 'dvb-preset-health-')
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    text: >-',
      '      You are a coding agent powered by the {{model}} model. Your working directory is {{cwd}}.',
      '',
    ].join('\n'),
  )
  const first = ensurePresetOverlay(dir)
  assert.equal(first.ok, true)
  const home = join(dir, 'home')
  await mkdir(join(home, '.agent-presets', 'vision-bench'), { recursive: true })
  const presetDir = join(home, '.agent-presets', 'vision-bench')
  for (const name of ['agent.cordis.yml', 'preset.yml', '.dsh-vision-bench']) {
    await writeFile(join(presetDir, name), await readFile(join(dir, name), 'utf8'))
  }
  await seedVisionBenchPreset(null, home)
  const health = await inspectPresetHealth(home)
  assert.equal(health.ok, true)
  assert.equal(health.appliesOnNewSession, true)
  assert.match(health.nextStep, /新建 Session/)
  assert.ok(health.generation)
  const again = ensurePresetOverlay(presetDir)
  assert.equal(again.unchanged, true)
})
test('inspectPresetHealth rejects yaml that parses but fails official persona schema', async (t) => {
  const home = await createTempDir(t, 'dvb-preset-schema-')
  const dir = join(home, '.agent-presets', 'vision-bench')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    text: You are a coding agent',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({
      owner: 'dsh-vision-bench',
      presetSchemaVersion: 3,
      pluginRowId: 'vision-bench-tools',
      lastManagedAt: '2026-01-01T00:00:00.000Z',
    }),
  )
  const health = await inspectPresetHealth(home)
  assert.equal(health.ok, false)
  assert.match(health.error, /prefix missing required value/)
})
test('inspectPresetHealth uses official Config and rejects wrong complete type', async (t) => {
  const home = await createTempDir(t, 'dvb-preset-complete-')
  const dir = join(home, '.agent-presets', 'vision-bench')
  await mkdir(dir, { recursive: true })
  await writeFile(
    join(dir, 'agent.cordis.yml'),
    [
      '- id: persona',
      "  name: '@deepseek-ai/dsh-persona'",
      '  config:',
      '    prefix: You are a coding agent',
      '    complete: wrong-type',
      '- id: vision-bench-tools',
      '  name: dsh-vision-bench/agent',
      '',
    ].join('\n'),
  )
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({
      owner: 'dsh-vision-bench',
      presetSchemaVersion: 3,
      pluginRowId: 'vision-bench-tools',
      lastManagedAt: '2026-01-01T00:00:00.000Z',
    }),
  )
  const health = await inspectPresetHealth(home)
  assert.equal(health.ok, false)
  assert.match(health.error, /complete|invalid|expected|type/i)
})
test('inspectPresetHealth surfaces a broken agent.cordis.yml', async (t) => {
  const home = await createTempDir(t, 'dvb-preset-broken-')
  const dir = join(home, '.agent-presets', 'vision-bench')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), ':\n  - [')
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({
      owner: 'dsh-vision-bench',
      presetSchemaVersion: 2,
      basePresetId: 'standard',
      pluginRowId: 'vision-bench-tools',
      lastManagedAt: '2026-01-01T00:00:00.000Z',
    }),
  )
  const health = await inspectPresetHealth(home)
  assert.equal(health.ok, false)
  assert.ok(health.error)
  assert.equal(health.appliesOnNewSession, true)
})
test('seedVisionBenchPreset does not overlay a foreign preset', async (t) => {
  const home = await createTempDir(t, 'dvb-preset-foreign-')
  const dir = join(home, '.agent-presets', 'vision-bench')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), 'name: other\n')
  const out = await seedVisionBenchPreset(null, home)
  assert.equal(out.ok, false)
  const text = await readFile(join(dir, 'agent.cordis.yml'), 'utf8')
  assert.equal(text, 'name: other\n')
})
test('preset yaml error does not overwrite', async (t) => {
  const dir = await createTempDir(t, 'dvb-yaml-')
  const bad = '- id: persona\n  config: [unclosed\n'
  await writeFile(join(dir, 'agent.cordis.yml'), bad)
  const out = ensurePresetOverlay(dir)
  assert.equal(out.ok, false)
  assert.ok(out.rebuildHelp)
  assert.equal(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'), bad)
})
test('fully consistent preset is left untouched (no backup, no writes)', async (t) => {
  const dir = await createTempDir(t, 'dvb-idem-')
  await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(LEGACY_PERSONA_A))
  const first = ensurePresetOverlay(dir)
  assert.equal(first.ok, true)
  trackBackup(t, first)
  const snapshot = {}
  for (const n of ['agent.cordis.yml', 'preset.yml', '.dsh-vision-bench']) {
    snapshot[n] = await readFile(join(dir, n), 'utf8')
  }
  const calls = []
  const out = await withFsPatched(
    {
      writeFileSync() {
        calls.push('write')
        throw new Error('must-not-write')
      },
      renameSync() {
        calls.push('rename')
        throw new Error('must-not-rename')
      },
      copyFileSync() {
        calls.push('copy')
        throw new Error('must-not-copy')
      },
      mkdirSync() {
        calls.push('mkdir')
        throw new Error('must-not-mkdir')
      },
    },
    () => ensurePresetOverlay(dir),
  )
  assert.equal(out.ok, true)
  assert.equal(out.unchanged, true)
  assert.deepEqual(calls, [], 'fully consistent preset must not trigger any write/backup')
  for (const n of Object.keys(snapshot)) {
    assert.equal(await readFile(join(dir, n), 'utf8'), snapshot[n], n + ' byte-identical on repeat run')
  }
})

test('invalid or foreign ownership marker fails closed and is never overwritten', async (t) => {
  const dir = await createTempDir(t, 'dvb-failclosed-')
  const standard = personaComposition(PRESET_PERSONA)
  const cases = [
    { name: 'garbage', marker: 'not-json {{{' },
    { name: 'unparseable-json', marker: '{"owner": ' },
    { name: 'foreign-owner', marker: JSON.stringify({ owner: 'someone-else' }) },
  ]
  for (const c of cases) {
    const sub = join(dir, c.name)
    await mkdir(sub, { recursive: true })
    await writeFile(join(dir, c.name, 'agent.cordis.yml'), standard)
    await writeFile(join(dir, c.name, '.dsh-vision-bench'), c.marker)
    let writes = 0
    const out = await withFsPatched(
      {
        writeFileSync(origWrite, p, ...r) {
          if (String(p).includes(sub)) {
            writes++
            throw new Error('must not write')
          }
          return origWrite(p, ...r)
        },
      },
      () => ensurePresetOverlay(sub),
    )
    assert.equal(out.ok, false, c.name + ' must fail closed')
    assert.match(out.error, /其他预设占用/)
    assert.equal(writes, 0, c.name + ' must not attempt any write')
    assert.equal(await readFile(join(sub, '.dsh-vision-bench'), 'utf8'), c.marker, c.name + ' marker untouched')
    assert.equal(await readFile(join(sub, 'agent.cordis.yml'), 'utf8'), standard, c.name + ' composition untouched')
  }
})
test('seedVisionBenchPreset fails closed on invalid ownership marker', async (t) => {
  const home = await createTempDir(t, 'dvb-seedfail-')
  const dir = join(home, '.agent-presets', 'vision-bench')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), personaComposition(PRESET_PERSONA))
  const marker = 'not-json {{{'
  await writeFile(join(dir, '.dsh-vision-bench'), marker)
  const out = await seedVisionBenchPreset(null, home)
  assert.equal(out.ok, false)
  assert.match(out.error, /其他预设占用/)
  assert.equal(await readFile(join(dir, '.dsh-vision-bench'), 'utf8'), marker, 'invalid marker untouched')
})
