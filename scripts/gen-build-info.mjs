// @ts-check
/**
 * Generate reproducible build-info.json for installed-product identity.
 * buildId = SHA-256 over sorted (path + content) of package.json files entries,
 * excluding build-info.json itself. builtAt is metadata only — not part of the hash.
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync, readdirSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, relative, sep } from 'node:path'
import { fileURLToPath } from 'node:url'
import { spawnSync } from 'node:child_process'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT = 'build-info.json'

/**
 * @param {string} dir
 * @param {string[]} acc
 */
function walkFiles(dir, acc = []) {
  for (const name of readdirSync(dir)) {
    if (name === 'node_modules' || name === '.git' || name === 'coverage') continue
    const full = join(dir, name)
    const st = statSync(full)
    if (st.isDirectory()) walkFiles(full, acc)
    else acc.push(full)
  }
  return acc
}

/**
 * Expand package.json files globs/dirs into concrete relative file paths.
 * @param {string} projectRoot
 * @param {string[]} entries
 */
export function expandPublishedFiles(projectRoot, entries) {
  /** @type {string[]} */
  const out = []
  for (const entry of entries) {
    if (entry === OUT) continue
    const full = join(projectRoot, entry)
    if (!existsSync(full)) continue
    const st = statSync(full)
    if (st.isFile()) {
      out.push(entry.split(sep).join('/'))
      continue
    }
    if (st.isDirectory()) {
      for (const abs of walkFiles(full)) {
        const rel = relative(projectRoot, abs).split(sep).join('/')
        if (rel === OUT) continue
        out.push(rel)
      }
    }
  }
  return [...new Set(out)].sort()
}

/**
 * @param {string} projectRoot
 * @param {string[]} relPaths
 */
export function computeBuildId(projectRoot, relPaths) {
  const hash = createHash('sha256')
  for (const rel of relPaths) {
    hash.update(rel)
    hash.update('\0')
    hash.update(readFileSync(join(projectRoot, rel)))
    hash.update('\0')
  }
  return hash.digest('hex')
}

/**
 * @param {string} [projectRoot]
 */
export function generateBuildInfo(projectRoot = root) {
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const files = Array.isArray(pkg.files) ? pkg.files.map(String) : []
  const published = expandPublishedFiles(projectRoot, files)
  const buildId = computeBuildId(projectRoot, published)
  let gitSha = ''
  const git = spawnSync('git', ['rev-parse', '--short', 'HEAD'], {
    cwd: projectRoot,
    encoding: 'utf8',
  })
  if (git.status === 0) gitSha = String(git.stdout || '').trim()
  const info = {
    pluginVersion: String(pkg.version || ''),
    buildId,
    gitSha: gitSha || undefined,
    builtAt: new Date().toISOString(),
    fileCount: published.length,
  }
  writeFileSync(join(projectRoot, OUT), `${JSON.stringify(info, null, 2)}\n`)
  return info
}

/**
 * @param {string} [projectRoot]
 */
export function verifyBuildInfo(projectRoot = root) {
  const path = join(projectRoot, OUT)
  if (!existsSync(path)) {
    return { ok: false, error: `${OUT} missing — run node scripts/gen-build-info.mjs` }
  }
  const recorded = JSON.parse(readFileSync(path, 'utf8'))
  const pkg = JSON.parse(readFileSync(join(projectRoot, 'package.json'), 'utf8'))
  const files = Array.isArray(pkg.files) ? pkg.files.map(String) : []
  const published = expandPublishedFiles(projectRoot, files)
  const buildId = computeBuildId(projectRoot, published)
  if (recorded.buildId !== buildId) {
    return {
      ok: false,
      error: `${OUT} buildId mismatch (stale). Re-run gen-build-info.mjs`,
      expected: buildId,
      actual: recorded.buildId,
    }
  }
  if (String(recorded.pluginVersion || '') !== String(pkg.version || '')) {
    return {
      ok: false,
      error: `${OUT} pluginVersion mismatch`,
      expected: pkg.version,
      actual: recorded.pluginVersion,
    }
  }
  return { ok: true, buildId, pluginVersion: recorded.pluginVersion }
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const info = generateBuildInfo()
  console.log(JSON.stringify({ event: 'vision.build-info', ...info }, null, 2))
}
