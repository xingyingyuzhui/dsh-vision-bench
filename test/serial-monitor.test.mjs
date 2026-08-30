import assert from 'node:assert/strict'
import { execFileSync } from 'node:child_process'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  closeSerialMonitor,
  feedConnectionFrames,
  listConnectedSerialSources,
  openSerialMonitor,
} from '../bench-serial-monitor.mjs'
import { saveWorkspace } from '../bench-store.mjs'
import { findPython } from './python.mjs'

test('frames layer refuses to open a serial port', async () => {
  const ran = await openSerialMonitor('/tmp/ws', { port: 'COM3' })
  assert.equal(ran.ok, false)
  assert.equal(ran.code, 'USE_HMI_CONNECT')
  assert.equal((await closeSerialMonitor('/tmp/ws')).ok, true)
})

test('listConnectedSerialSources only returns live connected RTU', async () => {
  const fake = {
    listConnections: async () => ({
      ok: true,
      data: {
        connections: [
          { connectionId: 'c1', port: 'COM3', state: 'connected' },
          { connectionId: 'c2', port: 'COM4', state: 'disconnected' },
          { connectionId: 'c3', port: '', state: 'connected', mode: 'tcp' },
        ],
      },
    }),
  }
  const home = await mkdtemp(join(tmpdir(), 'dvb-src-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        connections: [
          { id: 'c1', name: '温控器连接', enabled: true, conn: { mode: 'rtu', port: 'COM3' } },
          { id: 'c2', name: '传感器', enabled: true, conn: { mode: 'rtu', port: 'COM4' } },
          { id: 'c3', name: 'TCP', enabled: true, conn: { mode: 'tcp', host: '127.0.0.1', tcpPort: 502 } },
          { id: 'c4', name: '仿真', enabled: true, conn: { mode: 'rtu', port: 'COM5', sim: true } },
        ],
      },
    })
    const listed = await listConnectedSerialSources(home, cwd, { transport: fake })
    assert.deepEqual(
      listed.sources.map((s) => s.connectionId),
      ['c1'],
    )
    assert.equal(listed.sources[0].port, 'COM3')
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('capture feed is read-only and does not require leftover assembly', async () => {
  const chunks = [
    { id: 1, at: 1, hex: '616263', byteLength: 3, direction: 'tx', connectionId: 'c1', port: 'COM3' },
    { id: 2, at: 2, hex: '6465660A', byteLength: 4, direction: 'rx', connectionId: 'c1', port: 'COM3' },
  ]
  const fake = {
    captureFeed: async () => ({
      ok: true,
      data: { open: true, lines: chunks, lastId: 2, total: 2, port: 'COM3', state: 'connected' },
    }),
    listConnections: async () => ({
      ok: true,
      data: { connections: [{ connectionId: 'c1', port: 'COM3', state: 'connected' }] },
    }),
    getState: () => 'ready',
  }
  const feed = await feedConnectionFrames('/tmp/ws', { connectionId: 'c1' }, { transport: fake })
  assert.equal(feed.lines.length, 2)
  assert.equal(feed.lines[0].hex, '616263')
  assert.equal(feed.lines[1].hex, '6465660A')
})

test('openocd_flash.py validates inputs before spawning', async () => {
  const pythonBin = findPython()
  if (!pythonBin) return
  const script = fileURLToPath(new URL('../runtime/openocd_flash.py', import.meta.url))
  assert.ok(!script.startsWith('/D:'), script)
  assert.ok(!script.includes('D:\\D:'), script)
  const run = (args) => {
    try {
      const out = execFileSync(pythonBin, [script, ...args], { encoding: 'utf8', timeout: 15000, windowsHide: true })
      return JSON.parse(out.trim().split('\n').pop())
    } catch (error) {
      const stdout = String(error.stdout || '')
        .trim()
        .split('\n')
        .pop()
      if (!stdout) throw error
      return JSON.parse(stdout)
    }
  }
  const base = [
    '--openocd',
    '/nonexistent/openocd',
    '--interface',
    'cmsis-dap',
    '--target',
    'stm32f1x',
    '--file',
    '/nonexistent.hex',
    '--json',
  ]
  const missing = run(base)
  assert.equal(missing.status, 'error')
  assert.equal(missing.error.code, 'openocd_not_found')
})
