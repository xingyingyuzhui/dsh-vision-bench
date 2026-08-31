// Package contents: no legacy Python Modbus; version tracks current release.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package.json: version tracks package and no legacy python modbus files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(typeof pkg.version, 'string')
  assert.match(pkg.version, /^\d+\.\d+\.\d+/)
  const files = Array.isArray(pkg.files) ? pkg.files : []
  for (const bad of ['modbus_read.py', 'modbus_write.py', 'serial_monitor.py']) {
    assert.ok(!files.some((f) => String(f).indexOf(bad) >= 0), bad + ' must not be packaged')
  }
  assert.ok(
    files.some((f) => String(f).indexOf('keil_build.py') >= 0),
    'keil_build.py still packaged',
  )
  assert.ok(
    files.some((f) => String(f).indexOf('keil_project.py') >= 0),
    'keil_project.py still packaged',
  )
  assert.ok(!files.some((f) => String(f).indexOf('openocd_flash.py') >= 0), 'openocd_flash.py must not be packaged')
  assert.ok(
    files.some((f) => String(f).indexOf('openocd-runner.mjs') >= 0),
    'openocd-runner.mjs packaged',
  )
  assert.ok(
    files.some((f) => String(f).indexOf('openocd-profile.mjs') >= 0),
    'openocd-profile.mjs packaged',
  )
  for (const want of [
    'src/application/flash/flash-approval-service.mjs',
    'src/application/flash/openocd-health-service.mjs',
    'src/infrastructure/files/firmware-snapshot.mjs',
    'src/domain/flash/errors.mjs',
  ]) {
    assert.ok(
      files.some((f) => String(f) === want || String(f).indexOf(want) >= 0),
      want + ' packaged',
    )
  }
  // 可视化模块必须在发布包内
  for (const want of ['bench-visualization-model.mjs', 'bench-visualization-view.mjs']) {
    assert.ok(
      files.some((f) => String(f) === want),
      want + ' packaged',
    )
  }
  // runtime scripts no longer exist on disk
  const { access } = await import('node:fs/promises')
  for (const bad of [
    'runtime/modbus_read.py',
    'runtime/modbus_write.py',
    'runtime/serial_monitor.py',
    'runtime/openocd_flash.py',
  ]) {
    await assert.rejects(access(new URL('../' + bad, import.meta.url)), bad + ' deleted from source')
  }
  // UI 版本 chip 与 package 一致（禁止手改 client.js）
  const hmi = await readFile(new URL('../src/ui/hmi/device-card.mjs', import.meta.url), 'utf8')
  assert.ok(
    hmi.includes("'v" + pkg.version + "'") || hmi.includes('"v' + pkg.version + '"'),
    'HMI version chip matches package.json',
  )
})

test('bench-run script map keeps Keil python and drops OpenOCD python', async () => {
  const src = await readFile(new URL('../bench-run.mjs', import.meta.url), 'utf8')
  assert.ok(/keil_build\.py/.test(src))
  assert.ok(/keil_project\.py/.test(src))
  assert.ok(!/openocd_flash\.py/.test(src), 'no openocd_flash.py mapping')
  assert.ok(!/modbus_read\.py/.test(src), 'no modbus_read.py mapping')
  assert.ok(!/modbus_write\.py/.test(src), 'no modbus_write.py mapping')
})
