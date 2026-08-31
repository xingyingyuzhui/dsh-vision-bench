import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import {
  closeSerialMonitor,
  feedConnectionFrames,
  listConnectedSerialSources,
  openSerialMonitor,
} from '../bench-serial-monitor.mjs'
import { saveWorkspace } from '../bench-store.mjs'

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
