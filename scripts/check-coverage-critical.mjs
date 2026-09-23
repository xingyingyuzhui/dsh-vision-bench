// @ts-check
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Per-file line/branch floors, each about one point under the measured actual.
 * Raising a floor is a deliberate ratchet; lowering one needs a new measurement.
 *
 * @type {Record<string, { lines: number, branches: number }>}
 */
export const CRITICAL_FLOORS = {
  'src/application/modbus/write-approval-service.mjs': { lines: 99, branches: 91 },
  'src/application/modbus/write-execute.mjs': { lines: 89, branches: 70 },
  'src/application/modbus/write-service.mjs': { lines: 93, branches: 69 },
  'src/application/flash/flash-approval-service.mjs': { lines: 99, branches: 83 },
  'src/application/flash/flash-service.mjs': { lines: 95, branches: 85 },
  'src/application/flash/openocd-health-service.mjs': { lines: 99, branches: 83 },
  'src/infrastructure/harness/preset-declaration.mjs': { lines: 95, branches: 81 },
  'src/infrastructure/host/vision-preset-attach.mjs': { lines: 93, branches: 75 },
}

/**
 * @param {string} key
 * @param {string} projectRoot
 * @returns {string}
 */
export function relCoveragePath(key, projectRoot) {
  if (key === 'total') return ''
  const norm = String(key).replaceAll('\\', '/')
  const base = String(projectRoot).replaceAll('\\', '/').replace(/\/$/, '')
  if (norm.startsWith(`${base}/`)) return norm.slice(base.length + 1)
  return norm.replace(/^\.\//, '')
}

/**
 * c8 reports `"Unknown"` when a metric has no countable items. Treat that as full.
 *
 * @param {{ total?: number, pct?: number | string } | null | undefined} metric
 * @returns {number | null}
 */
export function metricPct(metric) {
  if (!metric || typeof metric !== 'object') return null
  if (metric.total === 0) return 100
  const pct = Number(metric.pct)
  return Number.isFinite(pct) ? pct : null
}

/**
 * @param {Record<string, { lines?: { total?: number, pct?: number | string }, branches?: { total?: number, pct?: number | string } }>} summary
 * @param {Record<string, { lines: number, branches: number }>} [floors]
 * @param {string} [projectRoot]
 * @returns {{ ok: boolean, violations: string[], checked: { file: string, lines: number | null, branches: number | null }[] }}
 */
export function evaluateCriticalCoverage(summary, floors = CRITICAL_FLOORS, projectRoot = root) {
  /** @type {Map<string, { lines?: { total?: number, pct?: number | string }, branches?: { total?: number, pct?: number | string } }>} */
  const byRel = new Map()
  for (const [key, value] of Object.entries(summary || {})) {
    const rel = relCoveragePath(key, projectRoot)
    if (rel) byRel.set(rel, value)
  }
  /** @type {string[]} */
  const violations = []
  /** @type {{ file: string, lines: number | null, branches: number | null }[]} */
  const checked = []
  for (const [file, floor] of Object.entries(floors)) {
    const entry = byRel.get(file)
    if (!entry) {
      violations.push(`missing coverage for ${file}`)
      continue
    }
    const lines = metricPct(entry.lines)
    const branches = metricPct(entry.branches)
    checked.push({ file, lines, branches })
    if (lines == null) violations.push(`${file}: line coverage is not a number`)
    else if (lines < floor.lines) violations.push(`${file}: lines ${lines}% is under the ${floor.lines}% floor`)
    if (branches == null) violations.push(`${file}: branch coverage is not a number`)
    else if (branches < floor.branches) {
      violations.push(`${file}: branches ${branches}% is under the ${floor.branches}% floor`)
    }
  }
  return { ok: violations.length === 0, violations, checked }
}

/**
 * @param {string} projectRoot
 * @param {string} [summaryPath]
 */
export function checkCriticalCoverageFile(projectRoot = root, summaryPath = join(projectRoot, 'coverage/coverage-summary.json')) {
  let summary
  try {
    summary = JSON.parse(readFileSync(summaryPath, 'utf8'))
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error)
    return { ok: false, violations: [`cannot read ${summaryPath}: ${message}`], checked: [] }
  }
  return evaluateCriticalCoverage(summary, CRITICAL_FLOORS, projectRoot)
}

function main() {
  const result = checkCriticalCoverageFile(root)
  if (!result.ok) {
    console.error(`critical coverage: ${result.violations.length} violation(s)`)
    for (const violation of result.violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log(`critical coverage ok (${result.checked.length} files)`)
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
