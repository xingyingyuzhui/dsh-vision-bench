import assert from 'node:assert/strict'
import { chmod, mkdir, mkdtemp, rm, writeFile } from 'node:fs/promises'
import { execFileSync } from 'node:child_process'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  closeSerialMonitor,
  openSerialMonitor,
  serialFeed,
  serialState,
} from '../bench-serial-monitor.mjs'
import { findPython } from './python.mjs'
import { journalView, loadWorkspace, saveBindings, saveWorkspace } from '../bench-store.mjs'


test('serial monitor guards bindings, port and unknown cwd', async () => {
  const cwd = '/tmp/dvb-serial-none'
  const noPython = openSerialMonitor('', cwd, { port: 'COM3' })
  assert.equal(noPython.ok, false)
  const noPort = openSerialMonitor(process.execPath, cwd, {})
  assert.equal(noPort.ok, false)
  const feed = serialFeed(cwd, 0)
  assert.equal(feed.ok, true)
  assert.equal(feed.open, false)
  assert.deepEqual(feed.lines, [])
  assert.equal(serialState(cwd).open, false)
  assert.equal(closeSerialMonitor(cwd).ok, true)
})

test('serial monitor streams JSON lines into a ring buffer', async () => {
  const pythonBin = findPython()
  if (!pythonBin) return
  const home = await mkdtemp(join(tmpdir(), 'dvb-serial-'))
  const fake = join(home, 'fake_python.py')
  await writeFile(fake, [
    'import json, sys, time',
    "print(json.dumps({'t': int(time.time()*1000), 'line': 'boot ok'}), flush=True)",
    "print(json.dumps({'t': int(time.time()*1000), 'line': 'ERROR: flash corrupt'}), flush=True)",
    'sys.stdout.flush()',
    'time.sleep(5)',
  ].join('\n'))
  if (process.platform !== 'win32') {
    await chmod(fake, 0o755)
  }
  const runner = process.platform === 'win32'
    ? join(home, 'fake_python.bat')
    : join(home, 'fake_python.sh')
  if (process.platform === 'win32') {
    await writeFile(runner, '@echo off\r\n"' + pythonBin + '" "' + fake + '" %*\r\n')
  } else {
    await writeFile(runner, '#!/bin/sh\nexec "' + pythonBin + '" "' + fake + '" "$@"\n')
    await chmod(runner, 0o755)
  }
  try {
    const opened = openSerialMonitor(runner, home, { port: 'FAKE', baudrate: 115200 })
    assert.equal(opened.ok, true)
    let feed = { lines: [] }
    for (let i = 0; i < 20 && (!feed.lines || feed.lines.length < 2); i++) {
      await new Promise((resolve) => setTimeout(resolve, 150))
      feed = serialFeed(home, 0)
    }
    assert.equal(feed.open, true)
    assert.equal(feed.lines.length, 2)
    assert.equal(feed.lines[0].line, 'boot ok')
    assert.equal(feed.lastId, 2)
    const since = serialFeed(home, 1)
    assert.equal(since.lines.length, 1)
    assert.equal(since.lines[0].line, 'ERROR: flash corrupt')
    closeSerialMonitor(home)
    assert.equal(serialState(home).open, false)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('openocd_flash.py validates inputs before spawning', () => {
  const pythonBin = findPython()
  if (!pythonBin) return
  const script = new URL('../runtime/openocd_flash.py', import.meta.url).pathname
  const run = (args) => {
    try {
      const out = execFileSync(pythonBin, [script, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true })
      return JSON.parse(out.trim().split('\n').pop())
    } catch (error) {
      return JSON.parse(String(error.stdout || '{}').trim().split('\n').pop() || '{}')
    }
  }
  const base = ['--openocd', '/nonexistent/openocd', '--interface', 'cmsis-dap', '--target', 'stm32f1x', '--file', '/nonexistent.hex', '--json']
  const missing = run(base)
  assert.equal(missing.status, 'error')
  assert.equal(missing.error.code, 'openocd_not_found')
  const badIface = run(['--openocd', '/bin/sh', '--interface', 'nope', '--target', 'stm32f1x', '--file', '/etc/hosts', '--json'])
  assert.equal(badIface.error.code, 'bad_interface')
  const badTarget = run(['--openocd', '/bin/sh', '--interface', 'cmsis-dap', '--target', 'nope', '--file', '/etc/hosts', '--json'])
  assert.equal(badTarget.error.code, 'bad_target')
})

test('openocdDownload refuses when firmware changed after confirmation', async () => {
  const { writeFileSync } = await import('node:fs')
  const { openocdDownload } = await import('../bench-flash.mjs')
  const home = await mkdtemp(join(tmpdir(), 'dvb-flash-toctou-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    const pythonBin = findPython() || process.execPath
    saveBindings(home, { python: process.execPath, uv4: '', openocd: '/bin/echo' })
    const fw = join(cwd, 'app.hex')
    writeFileSync(fw, 'v1')
    saveWorkspace(home, cwd, {
      keil: { download: fw },
      modbus: {},
    })
    const first = await openocdDownload(home, cwd, {
      interface: 'cmsis-dap',
      target: 'stm32f1x',
    })
    assert.equal(first.needsConfirm, true)
    assert.ok(first.request.sha256, 'expected a hash for a small file')
    // Firmware replaced under the same path after the card was shown.
    writeFileSync(fw, 'v2-with-different-bytes')
    const ran = await openocdDownload(home, cwd, {
      interface: 'cmsis-dap',
      target: 'stm32f1x',
      path: first.request.file,
      sha256: first.request.sha256,
      size: first.request.size,
      confirm: true,
    })
    assert.equal(ran.ok, false)
    assert.match(ran.error, /固件已变化/)
    const ws = loadWorkspace(home, cwd)
    assert.equal(journalView(ws).tasks.filter((item) => item.type === 'download').length, 0)
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})
