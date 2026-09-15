import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import config from '../source-assertions.config.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/** Filesystem APIs that mean "this test is looking at a file on disk". */
export const READ_APIS = [
  'readFile',
  'readFileSync',
  'createReadStream',
  'readdir',
  'readdirSync',
  'statSync',
  'lstatSync',
  'readlinkSync',
]

/** Extensions that count as hand-maintained source rather than a fixture asset. */
export const SOURCE_EXTENSIONS = ['.mjs', '.js', '.cjs', '.ts']

/**
 * True when a normalised target points at source under `anchor`: either a source
 * file with a known extension, or a directory. This deliberately rejects
 * `src/main.c` style literals that are temp-workspace fixtures, not our source.
 *
 * @param {string} target
 * @param {string} anchor
 * @returns {boolean}
 */
export function isSourceLike(target, anchor) {
  if (!target.startsWith(`${anchor}/`)) return false
  const rest = target.slice(anchor.length + 1)
  if (!rest) return true
  const last = rest.split('/').pop()
  if (!last) return true
  if (!last.includes('.')) return true
  return SOURCE_EXTENSIONS.some((ext) => last.endsWith(ext))
}

/**
 * Target categories, matched against the normalised target. `error` categories
 * need an allowlist entry; the rest are reported for visibility because the plan
 * explicitly permits reading generated artefacts, release manifests, tooling,
 * docs, shipped runtime assets, dependencies and fixtures.
 */
export const CATEGORY_RULES = [
  { category: 'source', error: true, test: (target) => isSourceLike(target, 'src') },
  { category: 'facade', error: true, test: (target) => /^bench-[a-z0-9-]+\.mjs$/.test(target) },
  { category: 'entry', error: true, test: (target) => /^(host|tools)\.js$/.test(target) },
  { category: 'runtime', error: true, test: (target) => isSourceLike(target, 'runtime') },
  { category: 'runtime-asset', error: false, test: (target) => /^runtime\/[A-Za-z0-9_./-]+\.(py|sh|json|txt)$/.test(target) },
  { category: 'generated', error: false, test: (target) => /^client\.js$/.test(target) },
  { category: 'release', error: false, test: (target) => /^package(-lock)?\.json$/.test(target) },
  { category: 'tooling', error: false, test: (target) => /^scripts\/[A-Za-z0-9_./-]+$/.test(target) },
  { category: 'docs', error: false, test: (target) => /^docs\/[A-Za-z0-9_./-]+$/.test(target) },
  { category: 'dependency', error: false, test: (target) => target.includes('node_modules/') },
]

export const ERROR_CATEGORIES = CATEGORY_RULES.filter((rule) => rule.error).map((rule) => rule.category)

/**
 * Purposes the plan allows a source-reading test to exist for, plus one
 * deliberate addition. `pending-refactor` marks a fragile lock that is only
 * permitted because P2-7 has not run yet; it must be the only purpose whose
 * entry count is expected to shrink, and no new entry may use it.
 */
export const ALLOWED_PURPOSES = [
  'architecture-boundary',
  'generated-artifact',
  'release-package',
  'security-banned-pattern',
  'version-contract',
  'pending-refactor',
]

export const EXCLUDED_DIRS = ['node_modules', 'coverage', 'dist', '.git', '.workbuddy-ai']

/** Guard against a runaway multi-line scan if an `import` never resolves. */
const MAX_IMPORT_LINES = 50

/**
 * Remove module specifiers so `import { x } from '../../src/ui/a.mjs'` is not
 * mistaken for a file read. Module dependencies are the dependency-cruiser
 * gate's job, not this one. The scan is line based on purpose: a lazy
 * whole-file regex would swallow real code between an `export const` and a
 * later `export ... from`.
 *
 * @param {string} source
 * @returns {string}
 */
export function stripModuleSpecifiers(source) {
  const lines = source.split('\n')
  const kept = []
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i]
    if (/^\s*import(?:\s|\{)/.test(line)) {
      if (/^\s*import\s*['"]/.test(line) || /\bfrom\s*['"]/.test(line)) continue
      let joined = line
      let j = i
      while (j + 1 < lines.length && j - i < MAX_IMPORT_LINES && !/\bfrom\s*['"]/.test(joined)) {
        j++
        joined += `\n${lines[j]}`
      }
      if (/\bfrom\s*['"]/.test(joined)) {
        i = j
        continue
      }
    }
    if (/^\s*export\b[^\n]*\bfrom\s*['"]/.test(line)) continue
    kept.push(line)
  }
  return kept
    .join('\n')
    .replace(/\bimport\s*\(\s*['"][^'"]*['"]\s*\)/g, '')
    .replace(/\brequire\s*\(\s*['"][^'"]*['"]\s*\)/g, '')
}

/**
 * @param {string} source
 * @returns {boolean}
 */
export function usesReadApi(source) {
  return READ_APIS.some((api) => new RegExp(`\\b${api}\\b`).test(source))
}

/**
 * @param {string} source
 * @returns {string[]} string and template literals, with interpolations masked
 */
export function collectStringLiterals(source) {
  const literals = []
  const patterns = [/'([^'\n]*)'/g, /"([^"\n]*)"/g, /`([^`\n]*)`/g]
  for (const pattern of patterns) {
    let match
    while ((match = pattern.exec(source))) {
      literals.push(match[1].replace(/\$\{[^}]*\}/g, '*'))
    }
  }
  return literals
}

/**
 * @param {string} literal
 * @returns {string|null}
 */
export function classifyLiteral(literal) {
  const target = normalizeTarget(literal)
  if (target === '<dynamic>') return null
  if (/\s/.test(target)) return null
  for (const rule of CATEGORY_RULES) {
    if (rule.test(target)) return rule.category
  }
  return null
}

/**
 * Normalise a literal into a stable target key so the allowlist can ratchet on
 * it. A dynamic path such as `'../' + name` collapses to `<dynamic>`.
 *
 * @param {string} literal
 * @returns {string}
 */
export function normalizeTarget(literal) {
  const anchor = literal.replace(/^(\.\.?\/)+/, '').replace(/^\/+/, '')
  if (!anchor || anchor === '.' || anchor === '..' || anchor === '<dynamic>') return '<dynamic>'
  return anchor
}

/**
 * @param {string} source
 * @param {string} relPath
 * @returns {{ file: string, flagged: boolean, categories: string[], targets: string[], fixtureOnly: boolean }}
 */
export function analyzeTestFile(source, relPath) {
  const body = stripModuleSpecifiers(source)
  const reads = usesReadApi(body)
  const categories = new Set()
  const targets = new Set()
  if (reads) {
    for (const literal of collectStringLiterals(body)) {
      const category = classifyLiteral(literal)
      if (!category) continue
      categories.add(category)
      targets.add(normalizeTarget(literal))
    }
  }
  const hits = [...categories].filter((category) => ERROR_CATEGORIES.includes(category))
  return {
    file: relPath,
    flagged: hits.length > 0,
    categories: [...categories].sort(),
    targets: [...targets].sort(),
    fixtureOnly: reads && categories.size === 0,
  }
}

/**
 * @param {string} dir
 * @param {string[]} acc
 * @returns {string[]}
 */
export function listTestFiles(dir, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (EXCLUDED_DIRS.includes(name) || name === 'fixtures') continue
    const full = join(dir, name)
    if (statSync(full).isDirectory()) listTestFiles(full, acc)
    else if (name.endsWith('.test.mjs')) acc.push(full)
  }
  return acc
}

/**
 * @param {string} projectRoot
 * @returns {{ file: string, flagged: boolean, categories: string[], targets: string[], fixtureOnly: boolean }[]}
 */
export function collectAudit(projectRoot = root) {
  return listTestFiles(join(projectRoot, 'test'))
    .map((file) => {
      const rel = relative(projectRoot, file).replaceAll('\\', '/')
      return analyzeTestFile(readFileSync(file, 'utf8'), rel)
    })
    .sort((a, b) => a.file.localeCompare(b.file))
}

/**
 * @param {string} projectRoot
 * @param {object} auditConfig
 * @returns {{ ok: boolean, violations: string[], audit: object[], allowlisted: object[] }}
 */
export function checkSourceAssertions(projectRoot = root, auditConfig = config) {
  const audit = collectAudit(projectRoot)
  const violations = []
  const allow = auditConfig.allow || []
  const byFile = new Map()

  for (const entry of allow) {
    if (!entry || typeof entry.file !== 'string' || !entry.file) {
      violations.push('allowlist entry without a file path')
      continue
    }
    if (entry.file.includes('*')) {
      violations.push(`allowlist must not use wildcards (${entry.file})`)
      continue
    }
    if (byFile.has(entry.file)) violations.push(`duplicate allowlist entry (${entry.file})`)
    byFile.set(entry.file, entry)
    if (!ALLOWED_PURPOSES.includes(entry.purpose)) {
      violations.push(`${entry.file}: purpose must be one of ${ALLOWED_PURPOSES.join(', ')}`)
    }
    if (!entry.reason) violations.push(`${entry.file}: allowlist entry needs a reason`)
    if (!Array.isArray(entry.targets) || entry.targets.length === 0) {
      violations.push(`${entry.file}: allowlist entry needs the exact target list it may read`)
    }
  }

  const allowlisted = []
  for (const item of audit) {
    const entry = byFile.get(item.file)
    if (!item.flagged) {
      if (entry) violations.push(`${item.file} no longer reads production source; remove it from the allowlist`)
      continue
    }
    if (!entry) {
      violations.push(`${item.file} reads production source (${item.categories.join(', ')}) without an allowlist entry`)
      continue
    }
    const allowed = entry.targets || []
    const added = item.targets.filter((target) => !allowed.includes(target))
    const removed = allowed.filter((target) => !item.targets.includes(target))
    if (added.length) violations.push(`${item.file} gained new production-source targets: ${added.join(', ')}`)
    if (removed.length) violations.push(`${item.file} no longer reads ${removed.join(', ')}; shrink its allowlist entry`)
    allowlisted.push({ ...item, purpose: entry.purpose, reason: entry.reason })
  }

  for (const entry of allow) {
    if (!audit.some((item) => item.file === entry.file)) {
      violations.push(`allowlisted test no longer exists (${entry.file})`)
    }
  }

  return { ok: violations.length === 0, violations, audit, allowlisted }
}

/**
 * @param {object} result
 * @returns {string}
 */
export function formatAudit(result) {
  const flagged = result.audit.filter((item) => item.flagged)
  const fixtureOnly = result.audit.filter((item) => item.fixtureOnly)
  const inert = result.audit.filter((item) => !item.flagged && !item.fixtureOnly)
  const lines = [
    `scanned ${result.audit.length} test files`,
    `  reads production source: ${flagged.length}`,
    `  reads fixtures only:     ${fixtureOnly.length}`,
    `  no filesystem reads:     ${inert.length}`,
    '',
    `production-source readers (${flagged.length}):`,
  ]
  for (const item of flagged) {
    lines.push(`  ${item.file}`)
    lines.push(`    categories: ${item.categories.join(', ')}`)
    lines.push(`    targets: ${item.targets.join(', ')}`)
  }
  return lines.join('\n')
}

function main() {
  const result = checkSourceAssertions(root)
  console.log(formatAudit(result))
  if (result.violations.length) {
    console.error('')
    console.error(`source assertions: ${result.violations.length} violation(s)`)
    for (const violation of result.violations) console.error(`  - ${violation}`)
    process.exit(1)
  }
  console.log('')
  console.log('source assertions ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
