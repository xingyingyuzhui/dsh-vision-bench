import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { classifyLog } from '../src/infrastructure/keil/uv4-build-runner.mjs'
import { toolchainBins } from '../src/infrastructure/keil/uv4-env.mjs'

test('classify_log separates after-build CreateProcess from compile errors', async () => {
  const afterLog = `Build target 'Target 1'
compiling main.c...
linking...
Program Size: Code=100 RO-data=8 RW-data=4 ZI-data=1024
".\\Objects\\app.axf" - 0 Error(s), 0 Warning(s).
User command #1: fromelf --bin -o Template.bin Template.axf
*** Error: CreateProcess failed, Command: 'fromelf --bin -o Template.bin Template.axf'
Target not created.
1 Error(s), 0 Warning(s).
`
  const compileLog = `compiling main.c...
..\\src\\main.c(12): error: #20: identifier "foo" is undefined
".\\Objects\\app.axf" - 1 Error(s), 0 Warning(s).
`

  const parsedAfter = classifyLog(afterLog)
  assert.equal(parsedAfter.phase, 'after_build')
  assert.equal(parsedAfter.metrics.compile_errors, 0)
  assert.ok(parsedAfter.metrics.after_build_errors >= 1)
  assert.ok(parsedAfter.errors.some((line) => /CreateProcess/i.test(line)))

  const parsedCompile = classifyLog(compileLog)
  assert.equal(parsedCompile.phase, 'compile')
  assert.ok(parsedCompile.metrics.compile_errors >= 1)
  assert.ok(parsedCompile.errors.some((line) => /foo/.test(line)))
})

test('toolchain_bins looks next to UV4 for ARMCC Bin', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-uv4-'))
  try {
    const uv4Dir = join(home, 'Keil_v5', 'UV4')
    const arm = join(home, 'Keil_v5', 'ARM', 'ARMCC', 'Bin')
    await mkdir(uv4Dir, { recursive: true })
    await mkdir(arm, { recursive: true })
    const uv4 = join(uv4Dir, 'UV4.exe')
    await writeFile(uv4, '')

    const bins = toolchainBins(uv4)
    assert.ok(bins.some((item) => item.replace(/\\/g, '/').endsWith('ARMCC/Bin') || item.endsWith('ARMCC\\Bin')))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
