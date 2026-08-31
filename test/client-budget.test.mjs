import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  CLIENT_BYTE_BASELINE,
  CLIENT_BYTE_LIMIT,
  assertClientBudget,
  normalizeNewlines,
  sha256Text,
} from '../scripts/check-client-budget.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const OK_SOURCE = `window.__ModuleLoader__.load({
  id: 'dsh-vision-bench',
  factory(require) {
    if (typeof require !== 'undefined') require("react")
    return { apply() {} }
  },
})
`

function spec(overrides = {}) {
  return {
    bytes: 1000,
    source: OK_SOURCE,
    ...overrides,
  }
}

test('client budget constants stay at the stage-1 cap', () => {
  assert.equal(CLIENT_BYTE_BASELINE, 567475)
  assert.equal(CLIENT_BYTE_LIMIT, 595849)
  assert.ok(CLIENT_BYTE_LIMIT > CLIENT_BYTE_BASELINE)
  assert.equal(CLIENT_BYTE_LIMIT, Math.round(CLIENT_BYTE_BASELINE * 1.05))
})

test('normalizeNewlines and sha256Text ignore CRLF', () => {
  assert.equal(normalizeNewlines('a\r\nb\rc'), 'a\nb\nc')
  assert.equal(sha256Text('hello\r\n'), sha256Text('hello\n'))
  assert.notEqual(sha256Text('hello\n'), sha256Text('hello'))
})

test('assertClientBudget accepts a factory that closes over require("react")', () => {
  assert.doesNotThrow(() => assertClientBudget(spec()))
})

test('assertClientBudget rejects oversize, missing size, and extra loaders', () => {
  assert.throws(() => assertClientBudget(spec({ bytes: CLIENT_BYTE_LIMIT + 1 })), /stage-1 limit/)
  assert.throws(() => assertClientBudget(spec({ bytes: 0 })), /missing byte size/)
  assert.throws(() => assertClientBudget(spec({ bytes: Number.NaN })), /missing byte size/)
  assert.throws(() => assertClientBudget(spec({ source: OK_SOURCE + OK_SOURCE })), /exactly one __ModuleLoader__/)
})

test('assertClientBudget rejects Node / serial requires and plot globals', () => {
  assert.throws(
    () => assertClientBudget(spec({ source: OK_SOURCE + '\nrequire("serialport")' })),
    /Node builtins or serial/,
  )
  assert.throws(() => assertClientBudget(spec({ source: OK_SOURCE + '\nrequire("react-dom")' })), /react-dom/)
  assert.throws(() => assertClientBudget(spec({ source: OK_SOURCE + '\nwindow.uPlot' })), /window\.uPlot/)
  assert.doesNotThrow(() =>
    assertClientBudget(spec({ source: OK_SOURCE + '\nconst css = "/path/to/file"; const os = 1' })),
  )
})

test('assertClientBudget requires the harness react factory contract', () => {
  assert.throws(
    () => assertClientBudget(spec({ source: 'window.__ModuleLoader__.load({ factory() { require("react") } })' })),
    /factory must take require/,
  )
  assert.throws(
    () =>
      assertClientBudget(
        spec({
          source: 'window.__ModuleLoader__.load({ factory(require) { require("react") } })',
        }),
      ),
    /require\("react"\) via the factory/,
  )
})

test('assertClientBudget rejects React / serial packages in the esbuild metafile', () => {
  assert.throws(
    () =>
      assertClientBudget(
        spec({
          clientMetafile: { inputs: { '/tmp/node_modules/react/index.js': { bytes: 12 } } },
        }),
      ),
    /React source was bundled/,
  )
  assert.throws(
    () =>
      assertClientBudget(
        spec({
          vendorMetafile: { inputs: { '/tmp/node_modules/serialport/index.js': { bytes: 12 } } },
        }),
      ),
    /serial\/modbus/,
  )
})

test('generated client.js is under the stage-1 budget', () => {
  const source = readFileSync(join(root, 'client.js'), 'utf8')
  const bytes = Buffer.byteLength(source, 'utf8')
  assert.ok(bytes <= CLIENT_BYTE_LIMIT, `client.js is ${bytes} bytes; limit ${CLIENT_BYTE_LIMIT}`)
  assert.ok(bytes > 0)
  assert.doesNotThrow(() => assertClientBudget({ bytes, source }))
})
