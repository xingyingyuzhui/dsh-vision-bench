import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { dirname } from 'node:path'
import { findPython } from './python.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')
const script = join(root, 'runtime', 'keil_build.py')
const pythonBin = findPython()
const skipPy = pythonBin ? false : 'no Python interpreter (python3 / python / py)'

function loadBuild() {
  const py = `
import importlib.util, json, sys
spec = importlib.util.spec_from_file_location("kb", ${JSON.stringify(script)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps({
  "after": mod.classify_log(${JSON.stringify(`Build target 'Target 1'
compiling main.c...
linking...
Program Size: Code=100 RO-data=8 RW-data=4 ZI-data=1024
".\\\\Objects\\\\app.axf" - 0 Error(s), 0 Warning(s).
User command #1: fromelf --bin -o Template.bin Template.axf
*** Error: CreateProcess failed, Command: 'fromelf --bin -o Template.bin Template.axf'
Target not created.
1 Error(s), 0 Warning(s).
`)}),
  "compile": mod.classify_log(${JSON.stringify(`compiling main.c...
..\\\\src\\\\main.c(12): error: #20: identifier "foo" is undefined
".\\\\Objects\\\\app.axf" - 1 Error(s), 0 Warning(s).
`)}),
  "bins": mod.toolchain_bins(${JSON.stringify(join('/opt', 'Keil_v5', 'UV4', 'UV4.exe'))}),
}))
`
  return JSON.parse(execFileSync(pythonBin, ['-c', py], { encoding: 'utf8' }))
}

test('classify_log separates after-build CreateProcess from compile errors', { skip: skipPy }, async () => {
  const parsed = loadBuild()
  assert.equal(parsed.after.phase, 'after_build')
  assert.equal(parsed.after.metrics.compile_errors, 0)
  assert.ok(parsed.after.metrics.after_build_errors >= 1)
  assert.ok(parsed.after.errors.some((line) => /CreateProcess/i.test(line)))
  assert.equal(parsed.compile.phase, 'compile')
  assert.ok(parsed.compile.metrics.compile_errors >= 1)
  assert.ok(parsed.compile.errors.some((line) => /foo/.test(line)))
})

test('toolchain_bins looks next to UV4 for ARMCC Bin', { skip: skipPy }, async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-uv4-'))
  try {
    const uv4Dir = join(home, 'Keil_v5', 'UV4')
    const arm = join(home, 'Keil_v5', 'ARM', 'ARMCC', 'Bin')
    await mkdir(uv4Dir, { recursive: true })
    await mkdir(arm, { recursive: true })
    const uv4 = join(uv4Dir, 'UV4.exe')
    await writeFile(uv4, '')
    const py = `
import importlib.util, json
spec = importlib.util.spec_from_file_location("kb", ${JSON.stringify(script)})
mod = importlib.util.module_from_spec(spec)
spec.loader.exec_module(mod)
print(json.dumps(mod.toolchain_bins(${JSON.stringify(uv4)})))
`
    const bins = JSON.parse(execFileSync(pythonBin, ['-c', py], { encoding: 'utf8' }))
    assert.ok(bins.some((item) => item.replace(/\\\\/g, '/').endsWith('ARMCC/Bin') || item.endsWith('ARMCC\\Bin')))
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
