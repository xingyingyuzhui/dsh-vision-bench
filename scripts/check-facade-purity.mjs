import { readdirSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath, pathToFileURL } from 'node:url'
import ts from 'typescript'
import { FACADE_COMPAT_ALLOWLIST } from './facade-compat-allowlist.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

/**
 * @param {string} projectRoot
 * @returns {string[]}
 */
export function listFacadeFiles(projectRoot = root) {
  return readdirSync(projectRoot)
    .filter((name) => name.startsWith('bench-') && name.endsWith('.mjs'))
    .sort()
}

/**
 * @param {string} fileName
 * @param {string} sourceText
 * @returns {{ kind: string, name?: string }[]}
 */
export function analyzeFacadeAst(fileName, sourceText) {
  const sf = ts.createSourceFile(fileName, sourceText, ts.ScriptTarget.Latest, true, ts.ScriptKind.JS)
  /** @type {{ kind: string, name?: string }[]} */
  const findings = []

  for (const stmt of sf.statements) {
    if (ts.isExportDeclaration(stmt) || ts.isExportAssignment(stmt)) {
      if (ts.isExportDeclaration(stmt) && stmt.moduleSpecifier && ts.isStringLiteral(stmt.moduleSpecifier)) {
        const target = stmt.moduleSpecifier.text
        if (/(^|\/)bench-[^/]+\.mjs$/.test(target) || target.startsWith('./bench-')) {
          findings.push({ kind: 'reexport-bench-facade', name: target })
        }
      }
      continue
    }
    if (ts.isImportDeclaration(stmt)) {
      findings.push({ kind: 'import' })
      continue
    }
    if (ts.isFunctionDeclaration(stmt) || ts.isClassDeclaration(stmt)) {
      findings.push({ kind: 'declaration', name: stmt.name?.text })
      continue
    }
    if (ts.isVariableStatement(stmt)) {
      for (const decl of stmt.declarationList.declarations) {
        const name = ts.isIdentifier(decl.name) ? decl.name.text : undefined
        // Allow `export const X = ...` only when it is a simple re-export identifier alias?
        // Any variable is impure for facade purity.
        findings.push({ kind: 'variable', name })
      }
      continue
    }
    if (ts.isExpressionStatement(stmt)) {
      findings.push({ kind: 'expression' })
    }
  }
  return findings
}

/**
 * @param {string} projectRoot
 * @returns {{ ok: boolean, violations: string[] }}
 */
export function checkFacadePurity(projectRoot = root) {
  const violations = []
  const allow = FACADE_COMPAT_ALLOWLIST || {}

  for (const name of listFacadeFiles(projectRoot)) {
    const text = readFileSync(join(projectRoot, name), 'utf8')
    const findings = analyzeFacadeAst(name, text)
    if (!findings.length) continue

    const entry = allow[name]
    if (!entry) {
      for (const f of findings) {
        violations.push(`${name}: impure facade (${f.kind}${f.name ? ` ${f.name}` : ''})`)
      }
      continue
    }

    // File-level allow: any impurity permitted until stage cleanup.
    // If exports listed, only those variable names are covered; other findings still fail.
    if (entry.exports && entry.exports.length) {
      for (const f of findings) {
        if (f.kind === 'import') continue // import needed to define allowed wrappers
        if (f.kind === 'variable' && f.name && entry.exports.includes(f.name)) continue
        if (f.kind === 'reexport-bench-facade' && !entry.exports.length) continue
        if (f.kind === 'reexport-bench-facade') {
          // Explicitly allowed by file entry when present in allowlist without export filter for reexports
          continue
        }
        if (f.kind === 'variable' && f.name && !entry.exports.includes(f.name)) {
          violations.push(`${name}: impure export ${f.name} not in compat allowlist`)
        }
        if (f.kind === 'declaration' || f.kind === 'expression') {
          violations.push(`${name}: impure facade (${f.kind}${f.name ? ` ${f.name}` : ''})`)
        }
      }
    }
    // else: whole-file allow — no violations
  }

  // Stale allowlist entries
  for (const name of Object.keys(allow)) {
    if (!listFacadeFiles(projectRoot).includes(name)) {
      violations.push(`facade allowlist: ${name} no longer exists; remove the entry`)
    }
  }

  return { ok: violations.length === 0, violations }
}

function main() {
  const result = checkFacadePurity(root)
  if (!result.ok) {
    console.error(`facade purity: ${result.violations.length} violation(s)`)
    for (const v of result.violations) console.error(`  - ${v}`)
    process.exit(1)
  }
  console.log('facade purity ok')
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main()
}
