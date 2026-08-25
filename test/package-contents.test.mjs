// Task11+12/0.19.2: the installable package must not ship legacy Python Modbus
// scripts, and the version must be the v0.19.2 stabilization line.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package.json: version 0.19.2 and no legacy python modbus files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(pkg.version, '0.19.2')
  const files = Array.isArray(pkg.files) ? pkg.files : []
  for (const bad of ['modbus_read.py', 'modbus_write.py', 'serial_monitor.py']) {
    assert.ok(!files.some((f) => String(f).indexOf(bad) >= 0), bad + ' must not be packaged')
  }
  // Keil/OpenOCD python must survive this round
  assert.ok(files.some((f) => String(f).indexOf('keil_build.py') >= 0), 'keil_build.py still packaged')
  assert.ok(files.some((f) => String(f).indexOf('openocd_flash.py') >= 0), 'openocd_flash.py still packaged')
  // runtime scripts no longer exist on disk
  const { access } = await import('node:fs/promises')
  for (const bad of ['runtime/modbus_read.py', 'runtime/modbus_write.py', 'runtime/serial_monitor.py']) {
    await assert.rejects(access(new URL('../' + bad, import.meta.url)), bad + ' deleted from source')
  }
})

test('bench-run script map keeps Keil/OpenOCD and drops modbus python', async () => {
  const src = await readFile(new URL('../bench-run.mjs', import.meta.url), 'utf8')
  assert.ok(/keil_build\.py/.test(src))
  assert.ok(/openocd_flash\.py/.test(src))
  assert.ok(!/modbus_read\.py/.test(src), 'no modbus_read.py mapping')
  assert.ok(!/modbus_write\.py/.test(src), 'no modbus_write.py mapping')
})