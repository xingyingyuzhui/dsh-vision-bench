import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import config from '../structure-budget.config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * Directories never walked by the budget, matching the plan's "exclude client.js,
 * coverage, dependencies and generated artefacts" rule.
 */
export const EXCLUDED_DIRS = ['node_modules', 'coverage', 'dist', '.git', '.workbuddy-ai']

/** Generated bundles are excluded here; the client budget gate covers them. */
export const EXCLUDED_FILES = ['client.js']

/**
 * Count logical lines the way `wc -l` does, so the numbers match the plan's
 * baseline table and a trailing newline does not add a phantom line.
 *
 * @param {string} text
 * @returns {number}
 */
export function countLines(text) {
  if (!text) return 0
  const newlines = text.match(/\n/g)
  return newlines ? newlines.length : 1
}

/**
 * @param {string} dir
 * @param {string[]} suffixes
 * @param {string[]} acc
 * @returns {string[]} absolute paths
 */
export function listFiles(dir, suffixes, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (EXCLUDED_DIRS.includes(name) || EXCLUDED_FILES.includes(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) listFiles(full, suffixes, acc)
    else if (suffixes.some((suffix) => name.endsWith(suffix))) acc.push(full)
  }
  return acc
}

/**
 * Resolve one group's file set. A group may use `dirs`, `rootPattern`, or both.
 *
 * @param {string} projectRoot
 * @param {object} group
 * @returns {string[]} posix paths relative to projectRoot, sorted
 */
export function collectGroupFiles(projectRoot, group) {
  const suffixes = group.suffixes || ['.mjs']
  const found = []
  for (const dir of group.dirs || []) found.push(...listFiles(join(projectRoot, dir), suffixes))
  if (group.rootPattern) {
    const pattern = new RegExp(group.rootPattern)
    let names = []
    try {
      names = readdirSync(projectRoot)
    } catch {
      names = []
    }
    for (const name of names) {
      if (EXCLUDED_DIRS.includes(name) || EXCLUDED_FILES.includes(name)) continue
      if (!pattern.test(name)) continue
      const full = join(projectRoot, name)
      if (statSync(full).isFile()) found.push(full)
    }
  }
  const rel = found.map((file) => relative(projectRoot, file).replaceAll('\\', '/'))
  return [...new Set(rel)].sort((a, b) => a.localeCompare(b))
}

/**
 * @param {string} projectRoot
 * @param {object} group
 * @returns {{ file: string, lines: number }[]}
 */
export function measureGroup(projectRoot, group) {
  return collectGroupFiles(projectRoot, group).map((file) => ({
    file,
    lines: countLines(readFileSync(join(projectRoot, file), 'utf8')),
  }))
}

/**
 * Validate one group's allowlist shape before trusting it. Wildcards are
 * rejected on purpose: a new oversized file must never slip in silently.
 *
 * @param {string} projectRoot
 * @param {object} group
 * @param {string[]} groupFiles
 * @returns {string[]}
 */
export function validateAllowlist(projectRoot, group, groupFiles) {
  const problems = []
  const seen = new Set()
  for (const entry of group.allow || []) {
    const file = entry && entry.file
    if (typeof file !== 'string' || !file) {
      problems.push(`${group.name}: allowlist entry without a file path`)
      continue
    }
    if (file.includes('*')) {
      problems.push(`${group.name}: allowlist must not use wildcards (${file})`)
      continue
    }
    if (seen.has(file)) problems.push(`${group.name}: duplicate allowlist entry (${file})`)
    seen.add(file)
    if (!entry.reason) problems.push(`${group.name}: allowlist entry needs a reason (${file})`)
    if (!entry.stage) problems.push(`${group.name}: allowlist entry needs an expiry stage (${file})`)
    if (typeof entry.max !== 'number') problems.push(`${group.name}: allowlist entry needs a numeric max (${file})`)
    if (!groupFiles.includes(file)) {
      problems.push(`${group.name}: allowlisted file is not part of this group or no longer exists (${file})`)
    }
  }
  return problems
}

/**
 * @param {string} projectRoot
 * @param {object} budget
 * @returns {{ ok: boolean, groups: object[], violations: string[], warnings: string[] }}
 */
export function checkBudget(projectRoot = root, budget = config) {
  const groups = []
  const violations = []
  const warnings = []

  for (const group of budget.groups) {
    const allow = group.allow || []
    const measured = measureGroup(projectRoot, group)
    const groupFiles = measured.map((item) => item.file)
    violations.push(...validateAllowlist(projectRoot, group, groupFiles))

    const byFile = new Map(allow.map((entry) => [entry.file, entry]))
    const overWarn = []
    const overError = []
    const allowlisted = []
    const stale = []

    for (const { file, lines } of measured) {
      const entry = byFile.get(file)
      if (lines > group.error) {
        overError.push({ file, lines })
        if (!entry) {
          violations.push(`${group.name}: ${file} is ${lines} lines, over the ${group.error}-line limit, and is not allowlisted`)
        } else if (lines > entry.max) {
          violations.push(`${group.name}: ${file} grew to ${lines} lines (allowlisted max ${entry.max}); split it instead of raising the budget`)
        } else {
          allowlisted.push({ file, lines, max: entry.max, stage: entry.stage, reason: entry.reason })
        }
      } else {
        if (lines > group.warn) overWarn.push({ file, lines })
        if (entry) {
          stale.push({ file, lines })
          violations.push(`${group.name}: ${file} is back under the ${group.error}-line limit (${lines}); remove it from the allowlist`)
        }
      }
    }

    overWarn.sort((a, b) => b.lines - a.lines)
    overError.sort((a, b) => b.lines - a.lines)
    groups.push({
      name: group.name,
      label: group.label,
      warn: group.warn,
      error: group.error,
      fileCount: measured.length,
      totalLines: measured.reduce((sum, item) => sum + item.lines, 0),
      overWarn,
      overError,
      allowlisted,
      stale,
    })
    warnings.push(...overWarn.map(({ file, lines }) => `${group.name}: ${file} is ${lines} lines (warn above ${group.warn})`))
  }

  return { ok: violations.length === 0, groups, violations, warnings }
}

/**
 * @param {object} result
 * @returns {string}
 */
export function formatReport(result) {
  const lines = []
  for (const group of result.groups) {
    lines.push(`[${group.name}] ${group.label}: ${group.fileCount} files, ${group.totalLines} lines`)
    if (group.overError.length) {
      lines.push(`  over ${group.error} lines (${group.overError.length}):`)
      for (const { file, lines: n } of group.overError) lines.push(`    ${String(n).padStart(5)}  ${file}`)
    } else {
      lines.push(`  over ${group.error} lines: none`)
    }
    if (group.overWarn.length) {
      lines.push(`  over ${group.warn} lines (${group.overWarn.length}):`)
      for (const { file, lines: n } of group.overWarn) lines.push(`    ${String(n).padStart(5)}  ${file}`)
    }
    if (group.allowlisted.length) {
      lines.push(`  allowlisted (${group.allowlisted.length}):`)
      for (const item of group.allowlisted) {
        lines.push(`    ${String(item.lines).padStart(5)}  ${item.file}  [${item.stage}] ${item.reason}`)
      }
    }
  }
  return lines.join('\n')
}

function main() {
  const result = checkBudget(root)
  console.log(formatReport(result))
  if (result.violations.length) {
    console.error('')
    console.error(`structure budget: ${result.violations.length} violation(s)`)
    for (const violation of result.violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log('')
  console.log('structure budget ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
