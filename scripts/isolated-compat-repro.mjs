#!/usr/bin/env node
import { mkdtemp, readFile, rm, writeFile, mkdir } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import { ensurePresetOverlay, inspectPresetHealth, seedVisionBenchPreset } from '../bench-preset.mjs'
import { loadOfficialPersonaConfig } from '../src/infrastructure/harness/dsh-contract.mjs'
import { validatePersonaConfig } from '../src/infrastructure/harness/preset-validate.mjs'

const root = dirname(fileURLToPath(import.meta.url))
const fixture = join(root, '../test/fixtures/legacy-vision-preset.yml')

const Config = await loadOfficialPersonaConfig()
const home = await mkdtemp(join(tmpdir(), 'dvb-compat-repro-'))
const report = []

try {
  const fresh = await seedVisionBenchPreset(null, home, { personaConfig: Config })
  report.push({ step: 'fresh-install', ok: fresh.ok === true, error: fresh.error || '' })
  const healthFresh = await inspectPresetHealth(home)
  report.push({ step: 'fresh-health', ok: healthFresh.ok === true, error: healthFresh.error || '' })

  const legacyHome = await mkdtemp(join(tmpdir(), 'dvb-compat-legacy-'))
  const dir = join(legacyHome, '.agent-presets', 'vision-bench')
  await mkdir(dir, { recursive: true })
  await writeFile(join(dir, 'agent.cordis.yml'), await readFile(fixture, 'utf8'))
  await writeFile(
    join(dir, '.dsh-vision-bench'),
    JSON.stringify({ owner: 'dsh-vision-bench', presetSchemaVersion: 2, pluginRowId: 'vision-bench-tools' }),
  )
  const migrated = ensurePresetOverlay(dir, { personaConfig: Config })
  report.push({ step: 'legacy-migrate', ok: migrated.ok === true, error: migrated.error || '' })
  const again = ensurePresetOverlay(dir, { personaConfig: Config })
  report.push({ step: 'legacy-idempotent', ok: again.ok === true && again.unchanged === true, error: again.error || '' })
  const healthLegacy = await inspectPresetHealth(legacyHome)
  report.push({ step: 'legacy-health', ok: healthLegacy.ok === true, error: healthLegacy.error || '' })

  const yaml = await import('yaml')
  const doc = yaml.parseDocument(await readFile(join(dir, 'agent.cordis.yml'), 'utf8'))
  for (const item of doc.contents.items) {
    if (item.get('id') === 'persona') {
      validatePersonaConfig(item.get('config').toJSON(), Config)
      report.push({ step: 'official-config', ok: true, error: '' })
    }
  }
  await rm(legacyHome, { recursive: true, force: true })
} finally {
  await rm(home, { recursive: true, force: true })
}

const failed = report.filter((row) => !row.ok)
for (const row of report) {
  console.log(`${row.ok ? 'ok' : 'FAIL'}  ${row.step}${row.error ? `  ${row.error}` : ''}`)
}
if (failed.length) process.exit(1)
console.log('isolated-compat-repro passed')
