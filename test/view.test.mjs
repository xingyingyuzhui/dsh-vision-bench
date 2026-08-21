import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import { formatResult } from '../bench-view.mjs'

const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bench-view.mjs'), 'utf8')
const runtime = readFileSync(join(dirname(fileURLToPath(import.meta.url)), '..', 'bench-runtime.mjs'), 'utf8')

test('formatResult keeps compile errors, phase and log path', () => {
  const text = formatResult({
    summary: '编译失败',
    metrics: { compile_errors: 2, after_build_errors: 0, warnings: 1 },
    details: {
      phase: 'compile',
      errors: ['main.c(12): error: #20: identifier "foo" is undefined'],
      log_file: '/tmp/vision-bench/logs/t1.log',
    },
  })
  assert.match(text, /编译失败/)
  assert.match(text, /编译\/链接 2/)
  assert.match(text, /阶段: 编译\/链接/)
  assert.match(text, /identifier "foo"/)
  assert.match(text, /t1\.log/)
})

test('debug run keeps structured ok:false instead of turning it into null', () => {
  assert.match(src, /if \(data && data\.ok === false\) setError/)
  assert.match(src, /return data/)
  assert.doesNotMatch(src, /if \(data && data\.ok === false\) throw/)
  assert.match(runtime, /if \(!res\.ok\) throw/)
  assert.doesNotMatch(runtime, /if \(data && data\.ok === false\) throw/)
  assert.match(src, /persist\([\s\S]*?\)\.then\(\(\) => \{\s*loadTargets/)
})
