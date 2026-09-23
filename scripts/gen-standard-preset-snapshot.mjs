#!/usr/bin/env node
// @ts-check
/**
 * Generate `src/infrastructure/harness/standard-preset-snapshot.mjs` from the
 * shipped `standard` agent preset of a pinned DSH release.
 *
 * DSH 0.1.7 made agent presets self-contained declarations: a third-party
 * preset must restate the complete child list instead of copying `standard`
 * (the registry exposes display metadata only, and `agentPresets.copy` is
 * gone). This script keeps that restatement faithful to upstream: every row
 * id, name, config and isolate value is copied verbatim, and `!!js` disabled
 * expressions are re-emitted as plain `platform` comparisons computed in the
 * registering Host process.
 *
 * Usage:
 *   node scripts/gen-standard-preset-snapshot.mjs --write [--tag <tag>] [--source <file>]
 *   node scripts/gen-standard-preset-snapshot.mjs --check
 *
 * Source resolution order: --source <file>, else `git show <tag>:<path>` in
 * --repo (default: ~/DSH/deepseek-harness-desktop-official).
 */
import { execFileSync } from 'node:child_process'
import { readFileSync, writeFileSync, existsSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { fileURLToPath } from 'node:url'
import * as yaml from 'yaml'
import { CORDIS_JS_TAG } from '../src/infrastructure/harness/preset-overlay.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const OUT_PATH = join(root, 'src/infrastructure/harness/standard-preset-snapshot.mjs')
const SOURCE_PATH_IN_REPO = 'packages/bundle/web-app/presets/standard.patch.yml'

const args = process.argv.slice(2)
const flag = (/** @type {string} */ name) => {
  const at = args.indexOf(name)
  return at >= 0 ? args[at + 1] : undefined
}
const mode = args.includes('--write') ? 'write' : args.includes('--check') ? 'check' : 'usage'
const sourceArg = flag('--source')
const outArg = flag('--out')
const repoArg = flag('--repo') || resolve(process.env.HOME || '', 'DSH/deepseek-harness-desktop-official')
const tagArg = flag('--tag') || 'dsh-v0.1.7-alpha.2'

/**
 * @returns {{ contract: string, raw: string }}
 */
function readSource() {
  if (sourceArg) {
    return { contract: flag('--contract') || 'file', raw: readFileSync(sourceArg, 'utf8') }
  }
  const raw = execFileSync('git', ['-C', repoArg, 'show', `${tagArg}:${SOURCE_PATH_IN_REPO}`], {
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  })
  return { contract: tagArg.replace(/^dsh-/, '').replace(/^v/, ''), raw }
}

/**
 * `!!js process.platform …` rows stay platform-conditional at registration
 * time. Any other expression must not be silently flattened — extend this
 * translation deliberately when upstream introduces one.
 *
 * @param {string} src
 * @returns {string}
 */
function translateJsExpr(src) {
  const trimmed = src.trim()
  if (!/^process\.platform\s*(===|!==)\s*['"][A-Za-z0-9_-]+['"]$/.test(trimmed)) {
    throw new Error(`unsupported !!js disabled expression: ${src}`)
  }
  return trimmed.replace(/process\.platform/g, 'platform')
}

/**
 * @param {unknown} value
 * @param {string} at
 * @returns {string}
 */
function emitScalar(value, at) {
  if (value && typeof value === 'object' && 'src' in /** @type {any} */ (value)) {
    return translateJsExpr(String(/** @type {any} */ (value).src))
  }
  if (value !== null && typeof value === 'object') {
    if (Array.isArray(value)) throw new Error(`${at}: unexpected inline list`)
    const entries = Object.entries(/** @type {Record<string, unknown>} */ (value))
    return `{ ${entries.map(([key, val]) => `${key}: ${emitScalar(val, `${at}.${key}`)}`).join(', ')} }`
  }
  return JSON.stringify(value ?? null)
}

const ROW_KEYS = ['id', 'name', 'group', 'isolate', 'config', 'disabled']

/**
 * @param {Record<string, unknown>} row
 * @param {string} at
 * @param {number} depth
 * @returns {string}
 */
function emitRow(row, at, depth) {
  if (!row || typeof row !== 'object' || Array.isArray(row)) {
    throw new Error(`${at}: expected a plugin row object`)
  }
  if (typeof row.name !== 'string' || row.name === '') {
    throw new Error(`${at}: row names no plugin`)
  }
  const indent = '  '.repeat(depth)
  /** @type {string[]} */
  const lines = []
  for (const key of ROW_KEYS) {
    if (row[key] === undefined) continue
    const value = row[key]
    if (key === 'config' && Array.isArray(value)) {
      if (row.group !== true) throw new Error(`${at}: list config without group: true`)
      const inner = /** @type {unknown[]} */ (value)
        .map((child, i) => emitRow(/** @type {Record<string, unknown>} */ (child), `${at}.config[${i}]`, depth + 2))
        .join(',\n')
      lines.push(`${indent}  config: [\n${inner},\n${indent}  ],`)
      continue
    }
    lines.push(`${indent}  ${key}: ${emitScalar(value, `${at}.${key}`)},`)
  }
  return `${indent}{\n${lines.join('\n')}\n${indent}}`
}

/**
 * The patch inserts `@deepseek-ai/dsh-agent-preset` declaration rows; the
 * preset's child list is each declaration's `config.plugins`.
 *
 * @param {unknown} patch
 * @returns {unknown[]}
 */
function extractChildRows(patch) {
  if (!Array.isArray(patch)) throw new Error('source patch must be a top-level list')
  /** @type {unknown[]} */
  const rows = []
  for (const layer of patch) {
    const insert = layer && /** @type {any} */ (layer).insert
    if (!Array.isArray(insert)) continue
    for (const row of insert) {
      const entry = /** @type {any} */ (row)
      if (entry.name !== '@deepseek-ai/dsh-agent-preset') continue
      if (entry.config.id !== 'standard') {
        throw new Error(`unexpected declaration id: ${String(entry.config.id)}`)
      }
      rows.push(...entry.config.plugins)
    }
  }
  if (rows.length === 0) throw new Error('source patch carries no standard preset children')
  return rows
}

/**
 * @param {string} contract
 * @param {unknown[]} rows
 * @returns {string}
 */
function renderModule(contract, rows) {
  const body = rows.map((row, i) => emitRow(/** @type {Record<string, unknown>} */ (row), `row${i}`, 2)).join(',\n')
  return `// @ts-check
/**
 * GENERATED FILE — do not edit by hand.
 *
 * Child rows of the shipped \`standard\` agent preset. Source of truth: DSH
 * \`${contract}\` \`${SOURCE_PATH_IN_REPO}\`.
 *
 * DSH 0.1.7+ presets are self-contained declarations (\`agentPresets.register\`),
 * so the Vision模式 preset restates standard's complete child list and appends
 * its own agent tool row (see preset-declaration.mjs). Regenerate and verify:
 *
 *   node scripts/gen-standard-preset-snapshot.mjs --write   # refresh
 *   node scripts/gen-standard-preset-snapshot.mjs --check   # drift gate
 */

/** DSH release whose \`standard\` preset these rows mirror. */
export const STANDARD_PRESET_SNAPSHOT_CONTRACT = '${contract}'

/**
 * @typedef {Object} StandardPresetChild
 * @property {string} [id]
 * @property {string} name
 * @property {true} [group]
 * @property {Record<string, boolean | string>} [isolate]
 * @property {Record<string, unknown> | StandardPresetChild[]} [config]
 * @property {boolean} [disabled]
 */

/**
 * Standard preset child rows.
 *
 * \`!!js process.platform\` rows arrive here as plain booleans: the registering
 * Host process is the platform that matters, so no expression is evaluated at
 * mount time. The returned objects are fresh per call.
 *
 * @param {{ platform?: string }} [options]
 * @returns {StandardPresetChild[]}
 */
export function buildStandardPresetChildren(options = {}) {
  const platform = options.platform || process.platform
  return [
${body},
  ]
}
`
}

if (mode === 'usage') {
  console.error('usage: gen-standard-preset-snapshot.mjs --write|--check [--source <file>] [--tag <tag>] [--repo <dir>]')
  process.exit(2)
}

const { contract, raw } = readSource()
const parsed = yaml.parse(raw, { customTags: [CORDIS_JS_TAG] })
const rendered = renderModule(contract, extractChildRows(parsed))
const outPath = outArg ? resolve(outArg) : OUT_PATH

if (mode === 'write') {
  writeFileSync(outPath, rendered)
  console.log(`wrote ${outPath} (${contract})`)
} else {
  const current = existsSync(outPath) ? readFileSync(outPath, 'utf8') : ''
  if (current !== rendered) {
    console.error(
      `standard-preset-snapshot drift against DSH ${contract}: run node scripts/gen-standard-preset-snapshot.mjs --write`,
    )
    process.exit(1)
  }
  console.log(`standard-preset-snapshot matches DSH ${contract}`)
}
