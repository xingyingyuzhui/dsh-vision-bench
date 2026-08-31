// @ts-check
import { createHash } from 'node:crypto'

export const CLIENT_BYTE_BASELINE = 567475
/** Stage-1 cap 595849; 0.24 ECharts 1048576; 0.25 adds CodeMirror. */
export const CLIENT_BYTE_LIMIT = 1572864

const REACT_SOURCE = /node_modules[/\\]react[/\\]/
const REACT_DOM_REQUIRE = /require\(['"]react-dom['"]\)/
const NODE_REQUIRE =
  /require\(['"](?:node:)?(?:fs|path|os|crypto|child_process|net|tls|http|https|stream|worker_threads|serialport|modbus-serial)['"]\)/
const BANNED_PACKAGES = /node_modules[/\\](?:serialport|modbus-serial)[/\\]/
const GLOBAL_PLOT = /(?:window|globalThis)\.(?:uPlot|echarts)\b/

/**
 * @param {string} text
 */
export function normalizeNewlines(text) {
  return String(text).replace(/\r\n/g, '\n').replace(/\r/g, '\n')
}

/**
 * @param {string} text
 */
export function sha256Text(text) {
  return createHash('sha256').update(normalizeNewlines(text), 'utf8').digest('hex')
}

/**
 * @param {Record<string, { bytes?: number, imports?: unknown[] }>} inputs
 * @param {RegExp} pattern
 */
function inputHits(inputs, pattern) {
  return Object.keys(inputs || {}).filter((file) => pattern.test(file.replaceAll('\\', '/')))
}

/**
 * @param {{
 *   bytes: number,
 *   source: string,
 *   vendorMetafile?: { inputs?: Record<string, unknown> },
 *   clientMetafile?: { inputs?: Record<string, unknown> },
 * }} spec
 */
export function assertClientBudget(spec) {
  const bytes = Number(spec.bytes)
  if (!Number.isFinite(bytes) || bytes <= 0) throw new Error('client budget: missing byte size')
  if (bytes > CLIENT_BYTE_LIMIT) {
    throw new Error(
      `client.js is ${bytes} bytes; 0.25 limit is ${CLIENT_BYTE_LIMIT} (stage-0 baseline ${CLIENT_BYTE_BASELINE})`,
    )
  }
  const source = String(spec.source || '')
  if ((source.match(/__ModuleLoader__\.load\(/g) || []).length !== 1) {
    throw new Error('client.js must contain exactly one __ModuleLoader__.load()')
  }
  if (REACT_DOM_REQUIRE.test(source)) throw new Error('client.js must not require react-dom')
  if (NODE_REQUIRE.test(source)) throw new Error('client.js must not require Node builtins or serial packages')
  if (GLOBAL_PLOT.test(source)) throw new Error('client.js must not leak window.uPlot / window.echarts')
  if (!/factory\s*\(\s*require\s*\)/.test(source)) throw new Error('client.js factory must take require')
  if (!/typeof require/.test(source) || !/\(\s*['"]react['"]\s*\)/.test(source)) {
    throw new Error('client.js must call require("react") via the factory')
  }

  const inputs = {
    ...(spec.vendorMetafile && spec.vendorMetafile.inputs ? spec.vendorMetafile.inputs : {}),
    ...(spec.clientMetafile && spec.clientMetafile.inputs ? spec.clientMetafile.inputs : {}),
  }
  const reactSource = inputHits(inputs, REACT_SOURCE)
  if (reactSource.length) throw new Error('React source was bundled: ' + reactSource.slice(0, 3).join(', '))
  const banned = inputHits(inputs, BANNED_PACKAGES)
  if (banned.length) throw new Error('Node serial/modbus packages were bundled: ' + banned.slice(0, 3).join(', '))
}
