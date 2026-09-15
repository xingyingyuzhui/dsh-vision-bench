import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  checkPackage,
  findClosureGaps,
  findDuplicateEntries,
  findMissingEntries,
  readManifest,
  resolveSpecifier,
} from '../../scripts/check-package.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Minimal package tree that satisfies the non-manifest checks.
 *
 * @param {string[]} files
 * @param {Record<string, string>} sources
 * @returns {string}
 */
function makePackage(files, sources = {}) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-pack-'))
  const pkg = { name: 'fixture-pkg', version: '1.0.0', files }
  writeFileSync(join(dir, 'package.json'), JSON.stringify(pkg, null, 2))
  writeFileSync(join(dir, 'host.js'), '// host\n')
  writeFileSync(join(dir, 'tools.js'), '// tools\n')
  writeFileSync(join(dir, 'client.js'), '// Do not edit by hand\n__ModuleLoader__\n"v1.0.0"\n')
  writeFileSync(join(dir, 'README.md'), '# fixture\n')
  writeFileSync(join(dir, 'LICENSE'), 'MIT\n')
  for (const [rel, body] of Object.entries(sources)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

test('duplicate and ghost manifest entries are both rejected', (t) => {
  const dir = makePackage(['host.js', 'host.js', 'src/gone.mjs'], { 'src/real.mjs': 'export const a = 1\n' })
  t.after(() => rmSync(dir, { recursive: true, force: true }))

  assert.deepEqual(findDuplicateEntries(['a', 'b', 'a', 'a']), ['a'])
  assert.deepEqual(findMissingEntries(dir, ['host.js', 'src/gone.mjs']), ['src/gone.mjs'])

  const result = checkPackage(dir)
  assert.equal(result.ok, false)
  assert.ok(result.problems.some((p) => p.includes('files[] lists host.js more than once')))
  assert.ok(result.problems.some((p) => p.includes('files[] points at a path that does not exist: src/gone.mjs')))
})

test('a shipped file importing an unshipped module fails the gate', (t) => {
  const sources = {
    'src/ui/page.mjs': "import { shared } from '../shared.mjs'\nexport const page = shared\n",
    'src/shared.mjs': 'export const shared = 1\n',
  }
  const broken = makePackage(['src/ui/page.mjs'], sources)
  t.after(() => rmSync(broken, { recursive: true, force: true }))
  const gaps = findClosureGaps(broken, readManifest(broken).files)
  assert.deepEqual(gaps, [{ from: 'src/ui/page.mjs', to: 'src/shared.mjs' }])
  const brokenResult = checkPackage(broken)
  assert.equal(brokenResult.ok, false)
  assert.ok(brokenResult.problems.some((p) => p.includes('src/ui/page.mjs -> src/shared.mjs')))

  const fixed = makePackage(['src/ui/page.mjs', 'src/shared.mjs'], sources)
  t.after(() => rmSync(fixed, { recursive: true, force: true }))
  assert.deepEqual(findClosureGaps(fixed, readManifest(fixed).files), [])
  assert.equal(checkPackage(fixed).ok, true)
})

test('bare and builtin specifiers are not treated as package gaps', (t) => {
  const dir = makePackage(['src/a.mjs'], {
    'src/a.mjs': "import { join } from 'node:path'\nimport x from 'some-npm-pkg'\nexport const a = [join, x]\n",
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.deepEqual(findClosureGaps(dir, readManifest(dir).files), [])
  assert.equal(checkPackage(dir).ok, true)
})

test('resolveSpecifier follows index files and reports unresolved targets', (t) => {
  const dir = makePackage(['src/a.mjs', 'src/dir/index.mjs'], {
    'src/a.mjs': 'export const a = 1\n',
    'src/dir/index.mjs': 'export const b = 2\n',
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(resolveSpecifier(dir, 'src/a.mjs', './dir'), 'src/dir/index.mjs')
  assert.equal(resolveSpecifier(dir, 'src/a.mjs', './nope.mjs'), null)
})

test('the committed manifest is duplicate-free, ghost-free and import-closed', () => {
  const result = checkPackage(root)
  assert.equal(result.ok, true, result.problems.join('\n'))
  assert.equal(result.counts.duplicates, 0)
  assert.equal(result.counts.missing, 0)
  assert.equal(result.counts.gaps, 0)
  assert.ok(result.counts.entries > 300, `expected a full manifest, got ${result.counts.entries}`)

  const { files } = readManifest(root)
  const shipped = new Set(files)
  for (const required of [
    'bench-shared.mjs',
    'bench-vendor.mjs',
    'src/ui/components/custom-select.mjs',
    'src/ui/styles/typography.mjs',
    'docs/architecture/ADR-019-debug-session-ownership.md',
    'docs/architecture/ADR-020-pending-write-session-ownership.md',
    'docs/architecture/ADR-021-alarm-condition-ack-model.md',
    'docs/architecture/ADR-022-verify-scenario-truthfulness.md',
    'docs/architecture/ADR-023-windows-validation-boundary.md',
  ]) {
    assert.ok(shipped.has(required), `${required} must ship`)
  }
  assert.ok(!shipped.has('src/ui/monitor/alarms/alarm-filter-model.mjs'), 'dead module must not ship')
  assert.ok(!shipped.has('src/ui/components/typography.mjs'), 'dead module must not ship')
})
