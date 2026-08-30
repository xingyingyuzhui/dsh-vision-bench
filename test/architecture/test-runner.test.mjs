import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { collectTestFiles, testFileArgs } from '../../scripts/run-tests.mjs'
import { listBenchFacades } from '../../scripts/run-with-bench.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function rel(file) {
  return file.slice(root.length + 1).replaceAll('\\', '/')
}

test('test runner lists nested *.test.mjs files without shell globs', () => {
  const files = collectTestFiles(root).map(rel)
  assert.ok(files.includes('test/architecture/typecheck-gate.test.mjs'))
  assert.ok(files.includes('test/config/hmi-config-persistence.test.mjs'))
  assert.ok(files.includes('test/host-contract.test.mjs'))
  assert.ok(files.length > 50, `expected a full suite, got ${files.length}`)
  assert.ok(!files.some((file) => file.includes('/fixtures/')))
  assert.equal(
    files.some((file) => file.endsWith('python.mjs') || file.endsWith('dom-stub.mjs')),
    false,
  )
  const args = testFileArgs(root)
  assert.equal(args.length, files.length)
  assert.ok(args.every((file) => file.startsWith('test')))
  assert.ok(!args.some((file) => file.includes('*')))
})

test('npm quality scripts do not rely on shell glob expansion', () => {
  const pkg = JSON.parse(readFileSync(join(root, 'package.json'), 'utf8'))
  assert.match(pkg.scripts['test:unit'], /scripts\/run-tests\.mjs/)
  assert.match(pkg.scripts['test:coverage'], /scripts\/run-tests\.mjs/)
  assert.match(pkg.scripts.lint, /scripts\/run-with-bench\.mjs lint/)
  assert.match(pkg.scripts['deps:check'], /scripts\/run-with-bench\.mjs deps/)
  for (const name of ['test:unit', 'test:coverage', 'lint', 'deps:check']) {
    assert.doesNotMatch(pkg.scripts[name], /\*/)
  }
  const benches = listBenchFacades(root)
  assert.ok(benches.includes('bench-hmi.mjs'))
  assert.ok(benches.includes('bench-runtime.mjs'))
  assert.ok(benches.length > 20, `expected bench facades, got ${benches.length}`)
  const script = readFileSync(join(root, 'scripts/run-tests.mjs'), 'utf8')
  assert.match(script, /endsWith\('\.test\.mjs'\)/)
  assert.match(script, /spawnSync/)
})
