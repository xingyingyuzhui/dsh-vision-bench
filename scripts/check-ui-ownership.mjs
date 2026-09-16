import { readdirSync, readFileSync, statSync } from 'node:fs'
import { dirname, join, relative } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import { UI_OWNERS, UI_OWNERSHIP_ALLOWLIST } from './ui-ownership-policy.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const SKIP_DIRS = new Set(['node_modules', 'coverage', 'dist', '.git', 'styles', 'test'])

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function walkMjs(dir, acc = []) {
  let entries = []
  try {
    entries = readdirSync(dir)
  } catch {
    return acc
  }
  for (const name of entries) {
    if (SKIP_DIRS.has(name)) continue
    const full = join(dir, name)
    let st
    try {
      st = statSync(full)
    } catch {
      continue
    }
    if (st.isDirectory()) walkMjs(full, acc)
    else if (name.endsWith('.mjs')) acc.push(full)
  }
  return acc
}

/**
 * Split className-ish string literals into CSS class tokens.
 * @param {string} text
 * @returns {Set<string>}
 */
export function extractClassTokens(text) {
  const tokens = new Set()
  const re = /className\s*:\s*(?:`([^`]*)`|'([^']*)'|"([^"]*)")/g
  let m
  while ((m = re.exec(text))) {
    const raw = m[1] ?? m[2] ?? m[3] ?? ''
    for (const part of raw.split(/[\s`$+{}]+/)) {
      const cleaned = part.replace(/[^a-zA-Z0-9_-]/g, '')
      if (cleaned) tokens.add(cleaned)
    }
  }
  // Also catch array / join patterns like 'dvb-select'
  const lit = /['"`](dvb-[a-z0-9-]+)['"`]/g
  while ((m = lit.exec(text))) tokens.add(m[1])
  return tokens
}

/**
 * @param {string} projectRoot
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkUiOwnership(projectRoot = root) {
  const violations = []
  const files = walkMjs(join(projectRoot, 'src/ui'))
  const allow = new Set(
    (UI_OWNERSHIP_ALLOWLIST || []).map((e) => `${e.file}::${e.token}`),
  )

  for (const abs of files) {
    const rel = relative(projectRoot, abs).replaceAll('\\', '/')
    if (rel.startsWith('src/ui/styles/')) continue
    const text = readFileSync(abs, 'utf8')
    const tokens = extractClassTokens(text)
    for (const [token, owner] of Object.entries(UI_OWNERS)) {
      if (rel === owner) continue
      if (!tokens.has(token)) continue
      if (allow.has(`${rel}::${token}`)) continue
      violations.push(`${rel} emits protected class "${token}" (owner: ${owner})`)
    }
  }

  return { ok: violations.length === 0, violations }
}

function main() {
  const result = checkUiOwnership(root)
  if (!result.ok) {
    console.error(`ui ownership: ${result.violations.length} violation(s)`)
    for (const v of result.violations) console.error(`  - ${v}`)
    process.exit(1)
  }
  console.log('ui ownership ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
