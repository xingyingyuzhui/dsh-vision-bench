import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { classifyLog, decodeLogBuffer, readLogText } from '../../src/infrastructure/keil/uv4-build-runner.mjs'

const __dirname = dirname(fileURLToPath(import.meta.url))
const fixturesDir = join(__dirname, '..', 'fixtures', 'keil')

test('classifyLog accurately analyzes successful build log', async () => {
  const content = await readFile(join(fixturesDir, 'sample-build-ok.log'), 'utf8')
  const classified = classifyLog(content)

  assert.equal(classified.phase, 'ok')
  assert.equal(classified.metrics.errors, 0)
  assert.equal(classified.metrics.warnings, 0)
  assert.equal(classified.metrics.compile_errors, 0)
  assert.equal(classified.metrics.after_build_errors, 0)
  assert.equal(classified.metrics.flash_bytes, 1204 + 256 + 20)
  assert.equal(classified.metrics.ram_bytes, 20 + 1024)
  assert.deepEqual(classified.errors, [])
  assert.ok(classified.excerpt.includes('Program Size:'))
})

test('classifyLog accurately analyzes compile error build log', async () => {
  const content = await readFile(join(fixturesDir, 'sample-build-error.log'), 'utf8')
  const classified = classifyLog(content)

  assert.equal(classified.phase, 'compile')
  assert.equal(classified.metrics.errors, 1)
  assert.equal(classified.metrics.warnings, 2)
  assert.equal(classified.metrics.compile_errors, 2)
  assert.equal(classified.metrics.after_build_errors, 0)
  assert.ok(classified.errors.some((e) => e.includes('identifier "foo" is undefined')))
  assert.deepEqual(classified.compile_errors, classified.errors)
})

test('classifyLog accurately analyzes after-build failure', async () => {
  const content = await readFile(join(fixturesDir, 'sample-after-build-error.log'), 'utf8')
  const classified = classifyLog(content)

  assert.equal(classified.phase, 'after_build')
  assert.equal(classified.metrics.compile_errors, 0)
  assert.ok(classified.metrics.after_build_errors >= 1)
  assert.ok(classified.errors.some((e) => /CreateProcess/i.test(e)))
  assert.deepEqual(classified.compile_errors, [])
})

test('decodeLogBuffer decodes UTF-8 with BOM and GBK encodings', () => {
  // UTF-8 with BOM
  const utf8WithBom = new Uint8Array([0xef, 0xbb, 0xbf, 0x68, 0x65, 0x6c, 0x6c, 0x6f])
  assert.equal(decodeLogBuffer(utf8WithBom), 'hello')

  // Plain UTF-8
  const utf8 = new TextEncoder().encode('测试编译')
  assert.equal(decodeLogBuffer(utf8), '测试编译')

  // Empty buffer
  assert.equal(decodeLogBuffer(new Uint8Array(0)), '')
})

test('readLogText returns empty string for nonexistent files', async () => {
  const text = await readLogText('/nonexistent/path/to/logfile.log')
  assert.equal(text, '')
})
