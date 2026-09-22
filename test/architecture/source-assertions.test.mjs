import assert from 'node:assert/strict'
import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import config from '../../source-assertions.config.mjs'
import {
  ALLOWED_PURPOSES,
  analyzeTestFile,
  checkSourceAssertions,
  classifyLiteral,
  collectStringLiterals,
  isSourceLike,
  normalizeTarget,
  stripModuleSpecifiers,
  usesReadApi,
} from '../../scripts/check-source-assertions.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const fixtureDir = join(root, 'test/fixtures/source-assertions')

/**
 * Synthetic test sources live under test/fixtures so the gate does not mistake
 * this file's own scenario text for a production-source read.
 *
 * @param {string} name
 * @returns {string}
 */
function fixture(name) {
  return readFileSync(join(fixtureDir, `${name}.mjs`), 'utf8')
}

/**
 * @param {Record<string, string>} spec
 * @returns {string}
 */
function makeTestTree(spec) {
  const dir = mkdtempSync(join(tmpdir(), 'dsh-assert-'))
  for (const [rel, body] of Object.entries(spec)) {
    const full = join(dir, 'test', rel)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, body)
  }
  return dir
}

test('module specifiers are stripped without swallowing later code', () => {
  const body = stripModuleSpecifiers(fixture('specifier-mix'))
  assert.ok(!body.includes('src/ui/foo.mjs'), 'multi-line import should be removed')
  assert.ok(!body.includes('src/ui/helper.mjs'), 'export-from should be removed')
  assert.ok(body.includes("export const TABLE = ['src/ui/bar.mjs']"), 'export const must survive')
  assert.ok(body.includes('bench-notify.mjs'), 'read call must survive')
  assert.equal(usesReadApi(body), true)
})

test('dynamic import and require specifiers are not treated as reads', () => {
  const body = stripModuleSpecifiers(fixture('dynamic-specifiers'))
  assert.ok(!body.includes('src/ui/x.mjs'))
  assert.ok(!body.includes('bench-y.mjs'))
  assert.equal(usesReadApi(body), false)
})

test('source-like classification separates source from temp fixtures', () => {
  assert.equal(isSourceLike('src/ui/hmi/hmi-page.mjs', 'src'), true)
  assert.equal(isSourceLike('src/ui/hmi', 'src'), true)
  assert.equal(isSourceLike('src/ui/hmi/', 'src'), true)
  assert.equal(isSourceLike('src/types/workspace.d.ts', 'src'), true)
  assert.equal(isSourceLike('src/main.c', 'src'), false, 'temp workspace fixture')
  assert.equal(isSourceLike('src/pass.sh', 'src'), false, 'temp workspace fixture')
  assert.equal(isSourceLike('bench-tool.mjs', 'src'), false)

  assert.equal(classifyLiteral('../../src/ui/foo.mjs'), 'source')
  assert.equal(classifyLiteral('../bench-notify.mjs'), 'facade')
  assert.equal(classifyLiteral('host.js'), 'entry')
  assert.equal(classifyLiteral('runtime/vision-io-worker.mjs'), 'runtime')
  assert.equal(classifyLiteral('runtime/modbus_read.py'), 'runtime-asset')
  assert.equal(classifyLiteral('client.js'), 'generated')
  assert.equal(classifyLiteral('package.json'), 'release')
  assert.equal(classifyLiteral('scripts/run-tests.mjs'), 'tooling')
  assert.equal(classifyLiteral('./fixtures/frame.json'), null)
  assert.equal(classifyLiteral('../'), null)
})

test('assertion messages and interpolations never become path targets', () => {
  assert.equal(classifyLiteral('bench-frames-view.mjs exists and registers a route'), null)
  assert.equal(normalizeTarget('../'), '<dynamic>')
  assert.equal(normalizeTarget('../../src/ui/foo.mjs'), 'src/ui/foo.mjs')
  const literals = collectStringLiterals('const s = `a${fs.readFileSync(new URL("../x.mjs", import.meta.url))}b`\n')
  assert.ok(literals.includes('a*b'), 'template interpolation is masked')
  assert.ok(literals.includes('../x.mjs'), 'inner literal is still visible')
  assert.ok(!literals.some((literal) => literal.includes('readFileSync')), 'code inside a template is not a literal')
})

test('a test is flagged only when it both reads files and names production source', () => {
  const reader = analyzeTestFile(fixture('facade-read'), 'test/a.test.mjs')
  assert.equal(reader.flagged, true)
  assert.deepEqual(reader.categories, ['facade'])
  assert.deepEqual(reader.targets, ['bench-view.mjs'])

  const fixtureOnly = analyzeTestFile(fixture('fixture-read'), 'test/b.test.mjs')
  assert.equal(fixtureOnly.flagged, false)
  assert.equal(fixtureOnly.fixtureOnly, true)

  const inert = analyzeTestFile(fixture('source-mention'), 'test/c.test.mjs')
  assert.equal(inert.flagged, false)
  assert.equal(inert.fixtureOnly, false)
})

test('a new production-source reader fails without an allowlist entry', (t) => {
  const dir = makeTestTree({ 'new-lock.test.mjs': fixture('ui-source-read') })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const result = checkSourceAssertions(dir, { allow: [] })
  assert.equal(result.ok, false)
  assert.ok(result.violations.some((v) => v.includes('test/new-lock.test.mjs reads production source')))
})

test('an allowlisted test may not gain a new production-source target', (t) => {
  const dir = makeTestTree({ 'lock.test.mjs': fixture('ui-source-read') })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const entry = {
    file: 'test/lock.test.mjs',
    purpose: 'pending-refactor',
    reason: 'UI 源码字符串锁',
    targets: ['src/ui/hmi/hmi-page.mjs'],
  }
  assert.equal(checkSourceAssertions(dir, { allow: [entry] }).ok, true)

  writeFileSync(join(dir, 'test/lock.test.mjs'), fixture('ui-source-two-reads'))
  const grown = checkSourceAssertions(dir, { allow: [entry] })
  assert.equal(grown.ok, false)
  assert.ok(grown.violations.some((v) => v.includes('gained new production-source targets: src/ui/hmi/device-card.mjs')))
})

test('allowlist entries must be well formed and self-cleaning', (t) => {
  const dir = makeTestTree({
    'lock.test.mjs': fixture('ui-source-read'),
    'clean.test.mjs': 'assert.equal(1, 1)\n',
  })
  t.after(() => rmSync(dir, { recursive: true, force: true }))
  const result = checkSourceAssertions(dir, {
    allow: [
      { file: 'test/*.test.mjs', purpose: 'pending-refactor', reason: 'x', targets: ['a'] },
      { file: 'test/lock.test.mjs', purpose: 'made-up', reason: 'x', targets: ['src/ui/hmi/hmi-page.mjs'] },
      { file: 'test/lock.test.mjs', purpose: 'pending-refactor', reason: 'x', targets: ['src/ui/hmi/hmi-page.mjs'] },
      { file: 'test/clean.test.mjs', purpose: 'pending-refactor', reason: 'x', targets: ['src/ui/hmi/hmi-page.mjs'] },
      { file: 'test/gone.test.mjs', purpose: 'pending-refactor', reason: 'x', targets: ['src/ui/hmi/hmi-page.mjs'] },
      { file: 'test/no-targets.test.mjs', purpose: 'pending-refactor', reason: 'x', targets: [] },
    ],
  })
  const joined = result.violations.join('\n')
  assert.match(joined, /allowlist must not use wildcards \(test\/\*\.test\.mjs\)/)
  assert.match(joined, /purpose must be one of/)
  assert.match(joined, /duplicate allowlist entry \(test\/lock\.test\.mjs\)/)
  assert.match(joined, /test\/clean\.test\.mjs no longer reads production source/)
  assert.match(joined, /allowlisted test no longer exists \(test\/gone\.test\.mjs\)/)
  assert.match(joined, /needs the exact target list it may read/)
  assert.match(joined, /test\/no-targets\.test\.mjs/)
})

test('the committed permission list matches the real suite', () => {
  const result = checkSourceAssertions(root, config)
  assert.equal(result.ok, true, result.violations.join('\n'))
  assert.equal(result.allowlisted.length, 23)
  assert.equal(config.allow.length, 23)
  assert.ok(result.audit.length > 200, `expected a full suite, got ${result.audit.length}`)

  const selfTest = config.allow.filter((entry) => entry.file === 'test/architecture/source-assertions.test.mjs')
  assert.equal(selfTest.length, 1, 'the gate self-test is the only entry allowed to read no production source')
  assert.equal(selfTest[0].purpose, 'architecture-boundary')

  for (const entry of config.allow) {
    assert.ok(ALLOWED_PURPOSES.includes(entry.purpose), `bad purpose for ${entry.file}`)
    assert.ok(entry.reason, `missing reason for ${entry.file}`)
    assert.ok(Array.isArray(entry.targets) && entry.targets.length > 0, `missing targets for ${entry.file}`)
    assert.ok(!entry.file.includes('*'), `wildcard in ${entry.file}`)
    assert.ok(!entry.targets.some((target) => target === '<dynamic>'), `unstable target in ${entry.file}`)
  }

  const pending = config.allow.filter((entry) => entry.purpose === 'pending-refactor')
  assert.equal(pending.length, 0, 'P2-7 backlog size changed; update the plan baseline')
  assert.ok(
    pending.every((entry) => entry.targets.some((target) => target.startsWith('src/ui/'))),
    'any remaining pending-refactor entry must still target src/ui',
  )
})
