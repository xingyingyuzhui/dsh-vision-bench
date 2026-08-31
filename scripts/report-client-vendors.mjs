import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
// @ts-check
import { gzipSync } from 'node:zlib'
import { CLIENT_BYTE_BASELINE, CLIENT_BYTE_LIMIT } from './check-client-budget.mjs'

export const VENDOR_GZIP_LIMIT = 300 * 1024
export const NEW_UI_LIBS = ['echarts', 'gridstack', '@codemirror/view', '@codemirror/state', '@codemirror/language']

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

function gzipLen(buf) {
  return gzipSync(buf).length
}

function packageOf(file) {
  const norm = String(file || '').replaceAll('\\', '/')
  const m = norm.match(/node_modules\/((?:@[^/]+\/)?[^/]+)/)
  return m ? m[1] : null
}

/**
 * @param {{
 *   clientSource?: string,
 *   vendorMetafile?: { inputs?: Record<string, { bytes?: number }> },
 * }} [spec]
 */
export function reportClientVendors(spec = {}) {
  const clientPath = join(root, 'client.js')
  const source =
    spec.clientSource != null ? spec.clientSource : existsSync(clientPath) ? readFileSync(clientPath) : Buffer.from('')
  const raw = Buffer.isBuffer(source) ? source : Buffer.from(String(source))
  const client = {
    raw: raw.length,
    gzip: gzipLen(raw),
    vsBaseline: raw.length - CLIENT_BYTE_BASELINE,
    vsLimit: CLIENT_BYTE_LIMIT - raw.length,
  }
  const meta =
    spec.vendorMetafile ||
    (() => {
      const p = join(root, 'coverage', 'tmp', 'vendor-meta.json')
      if (!existsSync(p)) return { inputs: {} }
      try {
        return JSON.parse(readFileSync(p, 'utf8'))
      } catch {
        return { inputs: {} }
      }
    })()
  /** @type {Record<string, { raw: number, gzip: number }>} */
  const vendors = {}
  for (const [file, info] of Object.entries(meta.inputs || {})) {
    const name = packageOf(file)
    if (!name) continue
    const abs = join(root, file)
    let gz = 0
    if (existsSync(abs)) {
      try {
        gz = gzipLen(readFileSync(abs))
      } catch {
        gz = 0
      }
    }
    const rec = vendors[name] || { raw: 0, gzip: 0 }
    rec.raw += Number(info?.bytes) || 0
    rec.gzip += gz
    vendors[name] = rec
  }
  const text = Buffer.isBuffer(source) ? source.toString('utf8') : String(source)
  const hasReactSource = /node_modules[/\\]react[/\\]/.test(text) || /from ['"]react['"]/.test(text)
  const requiresReact = /require\(['"]react['"]\)/.test(text)
  const hasReactDom = /react-dom/.test(text)
  const hasNodeSerial = /(?:serialport|modbus-serial|node:fs|node:child_process)/.test(text)
  const over = NEW_UI_LIBS.filter((name) => (vendors[name]?.gzip || 0) > VENDOR_GZIP_LIMIT)
  return {
    client,
    vendors,
    hasReactSource,
    requiresReact,
    hasReactDom,
    hasNodeSerial,
    overGzipLimit: over,
    gzipLimit: VENDOR_GZIP_LIMIT,
  }
}

function format(report) {
  const lines = [
    `client.js raw=${report.client.raw} gzip=${report.client.gzip} vsBaseline=${report.client.vsBaseline} vsLimit=${report.client.vsLimit}`,
    `react external require=${report.requiresReact} bundledSource=${report.hasReactSource} react-dom=${report.hasReactDom} node/serial=${report.hasNodeSerial}`,
  ]
  for (const [name, rec] of Object.entries(report.vendors).sort((a, b) => b[1].gzip - a[1].gzip)) {
    lines.push(`${name} raw=${rec.raw} gzip=${rec.gzip}`)
  }
  if (report.overGzipLimit.length) {
    lines.push(`gzip over ${report.gzipLimit}: ${report.overGzipLimit.join(', ')}`)
  }
  return lines.join('\n')
}

const isMain = process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]
if (isMain) {
  const report = reportClientVendors()
  process.stdout.write(`${format(report)}\n`)
  // Known 0.25 libraries are documented in VENDOR_SIZE_0.25.md; do not raise
  // CLIENT_BYTE_LIMIT to hide a new library. overGzipLimit is reported for review.
}
