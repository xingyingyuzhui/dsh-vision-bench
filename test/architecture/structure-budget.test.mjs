import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join, relative, sep } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import config from '../../structure-budget.config.mjs'
import { checkBudget, collectGroupFiles, countLines, listFiles, measureGroup } from '../../scripts/check-structure-budget.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * Build a throwaway tree; each entry is `{ 'rel/path.mjs': lineCount }`.
 *
 * @param {Record<string, number>} spec
 * @returns {string}
 */
function makeTree(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-budget-'))
  for (const [rel, lines] of Object.entries(spec)) {
    const full = join(dir, rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, 'x\n'.repeat(lines))
  }
  return dir
}

const GROUP = {
  name: 'production',
  label: 'test group',
  dirs: ['src'],
  suffixes: ['.mjs'],
  warn: 10,
  error: 20,
  allow: [],
}

test('countLines matches wc -l for trailing-newline files', (t) => {
  const dir = makeTree({ 'src/a.mjs': 7 })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  assert.equal(countLines('a\nb\nc\n'), 3)
  assert.equal(countLines(''), 0)
  assert.equal(countLines('a'), 1)
  assert.equal(measureGroup(dir, GROUP)[0].lines, 7)
})

test('structure budget excludes generated artefacts and dependency directories', (t) => {
  const dir = makeTree({
    'src/keep.mjs': 1,
    'src/nested/deep.mjs': 1,
    'src/node_modules/vendored.mjs': 1,
    'src/coverage/report.mjs': 1,
    'src/dist/bundle.mjs': 1,
    'client.js': 1,
    'src/types/ambient.d.ts': 1,
    'src/readme.md': 1,
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const files = collectGroupFiles(dir, GROUP)
  assert.deepEqual(files, ['src/keep.mjs', 'src/nested/deep.mjs'])
  const excluded = listFiles(join(dir, 'src'), ['.mjs']).map((file) =>
    relative(dir, file).split(sep).join('/'),
  )
  assert.ok(excluded.includes('src/nested/deep.mjs'))
  assert.ok(!excluded.some((file) => file.includes('node_modules')))
})

test('warn and error thresholds are reported separately', (t) => {
  const dir = makeTree({ 'src/ok.mjs': 5, 'src/warn.mjs': 15, 'src/over.mjs': 25 })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const result = checkBudget(dir, { groups: [GROUP] })
  const group = result.groups[0]
  assert.deepEqual(group.overWarn, [{ file: 'src/warn.mjs', lines: 15 }])
  assert.deepEqual(group.overError, [{ file: 'src/over.mjs', lines: 25 }])
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.includes('src/over.mjs is 25 lines')))
  assert.ok(result.violations.every((v) => !v.includes('src/warn.mjs')))
})

test('an allowlisted file passes but may not grow past its recorded max', (t) => {
  const dir = makeTree({ 'src/big.mjs': 25 })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const group = { ...GROUP, allow: [{ file: 'src/big.mjs', max: 25, reason: 'UI 组合', stage: 'P4-1' }] }
  const ok = checkBudget(dir, { groups: [group] })
  assert.equal(ok.ok, true)
  assert.equal(ok.groups[0].allowlisted.length, 1)

  writeFileSync(join(dir, 'src/big.mjs'), 'x\n'.repeat(26))
  const grown = checkBudget(dir, { groups: [group] })
  assert.equal(grown.ok, false)
  assert.ok(grown.violations.some((v) => v.includes('grew to 26 lines (allowlisted max 25)')))
})

test('allowlist entries must be removed once the file is back under the limit', (t) => {
  const dir = makeTree({ 'src/shrunk.mjs': 8 })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const group = { ...GROUP, allow: [{ file: 'src/shrunk.mjs', max: 25, reason: 'UI 组合', stage: 'P4-1' }] }
  const result = checkBudget(dir, { groups: [group] })
  assert.equal(result.ok, false)
  assert.deepEqual(result.groups[0].stale, [{ file: 'src/shrunk.mjs', lines: 8 }])
  assert.ok(result.violations.some((v) => v.includes('remove it from the allowlist')))
})

test('allowlist rejects wildcards, missing metadata, duplicates and ghost paths', (t) => {
  const dir = makeTree({ 'src/big.mjs': 25, 'src/other.mjs': 25 })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const result = checkBudget(dir, {
    groups: [
      {
        ...GROUP,
        allow: [
          { file: 'src/*.mjs', max: 25, reason: 'UI 组合', stage: 'P4-1' },
          { file: 'src/big.mjs', max: 25, reason: 'UI 组合' },
          { file: 'src/other.mjs', max: 25, stage: 'P4-1' },
          { file: 'src/other.mjs', max: 25, reason: 'UI 组合', stage: 'P4-1' },
          { file: 'src/gone.mjs', max: 25, reason: 'UI 组合', stage: 'P4-1' },
          { file: 'src/big.mjs', max: 25, reason: 'UI 组合', stage: 'P4-1' },
        ],
      },
    ],
  })
  assert.equal(result.ok, false)
  const joined = result.violations.join('\n')
  assert.match(joined, /must not use wildcards \(src\/\*\.mjs\)/)
  assert.match(joined, /needs an expiry stage \(src\/big\.mjs\)/)
  assert.match(joined, /needs a reason \(src\/other\.mjs\)/)
  assert.match(joined, /duplicate allowlist entry \(src\/other\.mjs\)/)
  assert.match(joined, /not part of this group or no longer exists \(src\/gone\.mjs\)/)
})

test('root-level groups match by pattern and never walk directories', (t) => {
  const dir = makeTree({ 'bench-a.mjs': 1, 'bench-b.mjs': 1, 'src/bench-c.mjs': 1, 'host.js': 1 })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const facade = { name: 'facade', label: 'facade', rootPattern: '^bench-.*\\.mjs$', warn: 0, error: 1 }
  assert.deepEqual(collectGroupFiles(dir, facade), ['bench-a.mjs', 'bench-b.mjs'])
  const entry = { name: 'entry', label: 'entry', rootPattern: '^(host|tools)\\.js$', warn: 0, error: 1 }
  assert.deepEqual(collectGroupFiles(dir, entry), ['host.js'])
})

test('the committed config passes and only lists known oversized files', () => {
  const result = checkBudget(root, config)
  assert.equal(result.ok, true, result.violations.join('\n'))
  const names = result.groups.map((group) => group.name)
  assert.deepEqual(names, ['production', 'facade', 'test'])

  const production = result.groups.find((group) => group.name === 'production')
  const facade = result.groups.find((group) => group.name === 'facade')
  const tests = result.groups.find((group) => group.name === 'test')
  assert.equal(production.overError.length, 0)
  assert.equal(production.allowlisted.length, 0)
  // P2-5 清零测试 >500：allowlist / overError 均为 0。
  assert.equal(tests.overError.length, 0)
  assert.equal(tests.allowlisted.length, 0)
  assert.equal(facade.overError.length, 0)
  assert.equal(facade.allowlisted.length, 0)

  for (const group of config.groups) {
    for (const entry of group.allow) {
      assert.ok(!entry.file.includes('*'), `wildcard in ${group.name}: ${entry.file}`)
      assert.ok(entry.reason, `missing reason for ${entry.file}`)
      assert.ok(entry.stage, `missing stage for ${entry.file}`)
      assert.ok(entry.max > group.error, `${entry.file} should not be allowlisted at ${entry.max}`)
    }
  }
})
