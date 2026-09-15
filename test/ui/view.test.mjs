import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { COPY } from '../../bench-i18n.mjs'
import { formatResult } from '../../bench-view.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')
const debugSources = [
  'bench-view.mjs',
  'src/ui/debug/debug-view.mjs',
  'src/ui/debug/use-debug-workspace-state.mjs',
  'src/ui/debug/use-debug-build-actions.mjs',
  'src/ui/debug/use-debug-flash-actions.mjs',
  'src/ui/debug/debug-project-panel.mjs',
  'src/ui/debug/debug-output-panel.mjs',
  'src/ui/debug/debug-flash-panel.mjs',
]
const src = debugSources.map((file) => readFileSync(join(root, file), 'utf8')).join('\n')
const runtime = readFileSync(join(root, 'src/ui/client/client-entry.mjs'), 'utf8')

test('formatResult keeps compile errors, phase and log path', async () => {
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

test('debug flash uses OpenOCD probe and server requestId, not a local whitelist', () => {
  assert.match(src, /\/dsh-vision-bench\/openocd\/probe/)
  assert.match(src, /requestId: req.requestId/)
  assert.match(src, /approved: true/)
  assert.match(src, /status: 'checking'/)
  assert.match(src, /openocdFlash.status !== 'ready'/)
  assert.match(src, /FLASH_INTERFACES/)
  assert.doesNotMatch(src, /const FLASH_IFACES/)
  assert.doesNotMatch(src, /confirm: true/)
})

test('OpenOCD same-path re-probe uses force and sequence, cancel failures are caught', () => {
  assert.match(src, /function probeOpenOcd/)
  assert.match(src, /probeOpenOcd\(\{\s*force:\s*true\s*\}\)/)
  assert.match(src, /probeSeqRef/)
  assert.match(src, /seq !== probeSeqRef\.current/)
  assert.match(src, /t\('openocdChecking'\)/)
  assert.match(src, /t\('openocdReprobe'\)/)
  assert.doesNotMatch(src, /openocdFlash.status === 'checking' \? t\('flashing'\)/)
  assert.match(src, /function cancelFlash/)
  assert.match(src, /approved: false[\s\S]{0,1200}\.catch/)
  assert.match(src, /flashCancelFail/)
  assert.match(src, /cancelBusy/)
  assert.match(src, /!force && boundPath === probedPathRef\.current/)
  assert.equal(COPY.zh.openocdChecking, '正在检查 OpenOCD…')
  assert.equal(COPY.zh.openocdReprobe, '重新探测')
})

test('debug run keeps structured ok:false instead of turning it into null', async () => {
  assert.match(src, /if \(data && data\.ok === false\) setError/)
  assert.match(src, /return data/)
  assert.doesNotMatch(src, /if \(data && data\.ok === false\) throw/)
  const rpcClient = readFileSync(join(root, 'src/infrastructure/host/vision-rpc-client.mjs'), 'utf8')
  // Transport layer only: outer result.ok !== true throws. Business ok:false resolves.
  assert.match(rpcClient, /ok !== true/)
  assert.match(rpcClient, /unwrapRpcResult/)
  assert.doesNotMatch(rpcClient, /data\.ok === false/)
  assert.doesNotMatch(runtime, /if \(data && data\.ok === false\) throw/)
  assert.match(src, /persist\([\s\S]*?\)\.then\(\(\) => \{\s*loadTargets/)
})
