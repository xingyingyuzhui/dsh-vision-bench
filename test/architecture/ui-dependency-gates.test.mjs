import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const cruiseBin = join(root, 'node_modules/dependency-cruiser/bin/dependency-cruise.mjs')
const configPath = join(root, 'dependency-cruiser.config.mjs')

test('P5-1 dependency-cruiser rules are registered', () => {
  const src = readFileSync(configPath, 'utf8')
  for (const name of [
    'ui-components-no-features',
    'ui-patterns-no-features',
    'ui-no-direct-vendor-packages',
  ]) {
    assert.ok(src.includes(`name: '${name}'`), `missing rule ${name}`)
  }
})

test('P5-1 UI dependency gates are green on the production graph', () => {
  const out = execFileSync(
    process.execPath,
    [
      cruiseBin,
      '--config',
      'dependency-cruiser.config.mjs',
      '--output-type',
      'err',
      'src',
      'host.js',
      'runtime/io',
    ],
    { cwd: root, encoding: 'utf8' },
  )
  assert.match(out, /no dependency violations|0 errors/)
  assert.doesNotMatch(out, /ui-components-no-features/)
  assert.doesNotMatch(out, /ui-patterns-no-features/)
  assert.doesNotMatch(out, /ui-no-direct-vendor-packages/)
})

test('ui-components-no-features fails when a component imports a feature module', () => {
  const fixture = join(
    root,
    'test/fixtures/architecture/src/ui/components/bad-feature-import.mjs',
  )
  let threw = false
  let combined = ''
  try {
    combined = execFileSync(
      process.execPath,
      [cruiseBin, '--config', 'dependency-cruiser.config.mjs', '--output-type', 'err', fixture],
      { cwd: root, encoding: 'utf8' },
    )
  } catch (err) {
    threw = true
    combined = `${err.stdout || ''}${err.stderr || ''}`
  }
  assert.ok(threw || /ui-components-no-features/.test(combined), 'expected components-no-features violation')
  assert.match(combined, /ui-components-no-features/)
})
