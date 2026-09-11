// Package contents: no legacy Python Modbus; version tracks current release.
import assert from 'node:assert/strict'
import { readFile } from 'node:fs/promises'
import test from 'node:test'

test('package.json: version tracks package and no legacy python modbus files', async () => {
  const pkg = JSON.parse(await readFile(new URL('../package.json', import.meta.url), 'utf8'))
  assert.equal(typeof pkg.version, 'string')
  assert.match(pkg.version, /^\d+\.\d+\.\d+/)
  const files = Array.isArray(pkg.files) ? pkg.files : []
  for (const bad of [
    'modbus_read.py',
    'modbus_write.py',
    'serial_monitor.py',
    'keil_build.py',
    'keil_project.py',
    'openocd_flash.py',
  ]) {
    assert.ok(!files.some((f) => String(f).indexOf(bad) >= 0), bad + ' must not be packaged')
  }
  assert.ok(
    files.some((f) => String(f).indexOf('openocd-runner.mjs') >= 0),
    'openocd-runner.mjs packaged',
  )
  assert.ok(
    files.some((f) => String(f).indexOf('openocd-profile.mjs') >= 0),
    'openocd-profile.mjs packaged',
  )
  for (const want of [
    'bench-guidance.mjs',
    'src/infrastructure/store/dsh-home.mjs',
    'src/infrastructure/harness/preset-validate.mjs',
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
  // UI 版本 chip 由构建注入；源码使用 __DVB_BUILD_VERSION__，未注入时显示 vdev，位于设置-Vision
  const settings = await readFile(new URL('../bench-settings.mjs', import.meta.url), 'utf8')
  assert.ok(settings.includes('__DVB_BUILD_VERSION__'), 'Settings version chip is build-injected')
  assert.ok(settings.includes("'vdev'") || settings.includes('"vdev"'), 'unbundled source falls back to vdev')
  assert.ok(!/v0\.\d+\.\d+/.test(settings), 'source must not hardcode a semver chip')
  const hmi = await readFile(new URL('../src/ui/hmi/device-card.mjs', import.meta.url), 'utf8')
  assert.ok(!hmi.includes('__DVB_BUILD_VERSION__'), 'HMI device card does not show version chip')
  const build = await readFile(new URL('../scripts/build-client.mjs', import.meta.url), 'utf8')
  assert.ok(build.includes('__DVB_BUILD_VERSION__'), 'build injects package version')
  assert.ok(build.includes('pkg.version'), 'build reads package.json version')
})

test('bench-run script map drops Keil and OpenOCD python scripts', async () => {
  const src = await readFile(new URL('../bench-run.mjs', import.meta.url), 'utf8')
  assert.ok(!/keil_build\.py/.test(src), 'no keil_build.py mapping')
  assert.ok(!/keil_project\.py/.test(src), 'no keil_project.py mapping')
  assert.ok(!/openocd_flash\.py/.test(src), 'no openocd_flash.py mapping')
  assert.ok(!/modbus_read\.py/.test(src), 'no modbus_read.py mapping')
  assert.ok(!/modbus_write\.py/.test(src), 'no modbus_write.py mapping')
})
