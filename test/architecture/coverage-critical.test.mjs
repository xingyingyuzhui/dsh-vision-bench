import assert from 'node:assert/strict'
import { readdirSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CRITICAL_FLOORS,
  evaluateCriticalCoverage,
  metricPct,
  relCoveragePath,
} from '../../scripts/check-coverage-critical.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

/**
 * @param {number} lines
 * @param {number} branches
 * @param {{ lineTotal?: number, branchTotal?: number, branchPct?: number | string }} [extra]
 */
function entry(lines, branches, extra = {}) {
  return {
    lines: { total: extra.lineTotal ?? 10, covered: 1, pct: lines },
    branches: { total: extra.branchTotal ?? 4, covered: 1, pct: extra.branchPct ?? branches },
  }
}

test('coverage paths normalize absolute, relative, and windows keys', () => {
  assert.equal(relCoveragePath('total', root), '')
  assert.equal(
    relCoveragePath(`${root}/src/application/modbus/write-service.mjs`, root),
    'src/application/modbus/write-service.mjs',
  )
  assert.equal(
    relCoveragePath('C:\\repo\\src\\application\\flash\\flash-service.mjs', 'C:\\repo'),
    'src/application/flash/flash-service.mjs',
  )
  assert.equal(relCoveragePath('./src/application/flash/flash-service.mjs', root), 'src/application/flash/flash-service.mjs')
})

test('empty metrics count as fully covered and non-numeric percentages do not', () => {
  assert.equal(metricPct({ total: 0, pct: 'Unknown' }), 100)
  assert.equal(metricPct({ total: 4, pct: 70.47 }), 70.47)
  assert.equal(metricPct({ total: 4, pct: 'Unknown' }), null)
  assert.equal(metricPct(null), null)
})

test('critical coverage flags missing files and floors, and accepts files at the floor', () => {
  const file = 'src/application/modbus/write-service.mjs'
  const floors = { [file]: { lines: 93, branches: 69 } }
  const project = '/repo'
  const key = '/repo/src/application/modbus/write-service.mjs'

  const missing = evaluateCriticalCoverage({}, floors, project)
  assert.equal(missing.ok, false)
  assert.match(missing.violations.join('\n'), /missing coverage for src\/application\/modbus\/write-service\.mjs/)

  const lowLines = evaluateCriticalCoverage({ [key]: entry(92.9, 80) }, floors, project)
  assert.equal(lowLines.ok, false)
  assert.match(lowLines.violations.join('\n'), /lines 92\.9% is under the 93% floor/)

  const lowBranches = evaluateCriticalCoverage({ [key]: entry(94, 68.5) }, floors, project)
  assert.equal(lowBranches.ok, false)
  assert.match(lowBranches.violations.join('\n'), /branches 68\.5% is under the 69% floor/)

  const exact = evaluateCriticalCoverage({ [key]: entry(93, 69) }, floors, project)
  assert.equal(exact.ok, true, exact.violations.join('\n'))
  assert.deepEqual(exact.checked, [{ file, lines: 93, branches: 69 }])

  const noBranches = evaluateCriticalCoverage(
    { [key]: entry(93, 0, { branchTotal: 0, branchPct: 'Unknown' }) },
    floors,
    project,
  )
  assert.equal(noBranches.ok, true, noBranches.violations.join('\n'))
  assert.equal(noBranches.checked[0].branches, 100)
})

test('committed floors cover write, flash, preset declaration, and preset attach', () => {
  const write = readdirSync(join(root, 'src/application/modbus'))
    .filter((name) => name.startsWith('write-') && name.endsWith('.mjs'))
    .map((name) => `src/application/modbus/${name}`)
  const flash = readdirSync(join(root, 'src/application/flash'))
    .filter((name) => name.endsWith('.mjs'))
    .map((name) => `src/application/flash/${name}`)
  const expected = [
    ...write,
    ...flash,
    'src/infrastructure/harness/preset-declaration.mjs',
    'src/infrastructure/host/vision-preset-attach.mjs',
  ].sort()
  assert.deepEqual(Object.keys(CRITICAL_FLOORS).sort(), expected)
  for (const floor of Object.values(CRITICAL_FLOORS)) {
    assert.equal(Number.isInteger(floor.lines), true)
    assert.equal(Number.isInteger(floor.branches), true)
    assert.ok(floor.lines >= 0 && floor.lines <= 100)
    assert.ok(floor.branches >= 0 && floor.branches <= 100)
  }
})
