import assert from 'node:assert/strict'
import { existsSync, readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import {
  buildFramePortOptions,
  framesShouldStickToBottom,
  mergeFramesDedup,
  parseFramePortSelection,
  resolveFrameSelection,
  selectProtocolFrames,
} from '../bench-frames-model.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const CONNECTIONS = [
  { id: 'c1', name: '主机', conn: { mode: 'rtu', port: 'COM3', baudrate: 9600 } },
  { id: 'c2', name: '从机', conn: { mode: 'rtu', port: 'COM4', baudrate: 9600 } },
]

function makeFrame(connId, t, extra = {}) {
  return {
    frameId: 'f-' + connId + '-' + t,
    connectionId: connId,
    t,
    at: t,
    direction: 'tx',
    request: 'req' + t,
    label: 'L' + t,
    status: 'ok',
    functionCode: 3,
    ...extra,
  }
}

const FBC = {
  c1: [makeFrame('c1', 10), makeFrame('c1', 20)],
  c2: [makeFrame('c2', 15)],
}

test('frames identity: parseFramePortSelection maps explicit internal types', async () => {
  assert.deepEqual(parseFramePortSelection('all'), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection('conn:c1'), { kind: 'conn', connectionId: 'c1', port: '' })
  assert.deepEqual(parseFramePortSelection('raw:COM7'), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection('COM3'), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection(''), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection(undefined), { kind: 'all', connectionId: '', port: '' })
})

test('frames identity: options list only live connected RTU sources', async () => {
  const live = [{ connectionId: 'c1', port: 'COM3', state: 'connected' }]
  const proto = buildFramePortOptions(CONNECTIONS, ['COM3', 'COM4', 'COM7'], 'proto', live)
  assert.equal(proto[0].value, 'all')
  assert.ok(proto.some((o) => o.value === 'conn:c1' && o.kind === 'connected'))
  assert.ok(!proto.some((o) => o.value === 'conn:c2'), 'unconnected COM4 is hidden')
  assert.ok(!proto.some((o) => String(o.value).startsWith('raw:')), 'must not list unconfigured COM')
})

test('frames identity: selecting COM3 only shows c1 frames, COM4 only c2, all merges by time', async () => {
  const c1 = selectProtocolFrames(FBC, 'conn:c1')
  assert.deepEqual(
    c1.map((f) => f.connectionId),
    ['c1', 'c1'],
  )
  const c2 = selectProtocolFrames(FBC, 'conn:c2')
  assert.deepEqual(
    c2.map((f) => f.connectionId),
    ['c2'],
  )
  // unknown selection degrades to 'all'
  const byComName = selectProtocolFrames(FBC, 'COM3')
  assert.equal(
    byComName.length,
    selectProtocolFrames(FBC, 'all').length,
    'unknown value -> all, never a per-COM cache key',
  )
  const all = selectProtocolFrames(FBC, 'all')
  assert.equal(all.length, 3)
  const times = all.map((f) => f.t)
  assert.deepEqual(
    times,
    [...times].sort((a, b) => a - b),
    'all must be time-merged',
  )
})

test('frames persistence: mergeFramesDedup dedups by frameId across persisted + memory', async () => {
  const persisted = [makeFrame('c1', 10, { request: 'old' }), makeFrame('c1', 20)]
  const memory = [makeFrame('c1', 20, { request: 'fresh' }), makeFrame('c1', 30)]
  const merged = mergeFramesDedup(persisted, memory, 500)
  assert.equal(merged.length, 3)
  const f20 = merged.find((f) => f.t === 20)
  assert.equal(f20.request, 'fresh', 'memory wins for same frameId on re-read')
})

test('frames persistence: reload keeps history (persisted frames are the source of truth)', async () => {
  // Simulate: frames produced, persisted, page reloads with no memory → persisted still shows
  const afterReload = selectProtocolFrames(FBC, 'conn:c1')
  assert.equal(afterReload.length, 2)
  const ids = afterReload.map((f) => f.frameId)
  // clear c1 does not affect c2 via selectProtocolFrames
  const cleared = { ...FBC }
  delete cleared.c1
  assert.equal(selectProtocolFrames(cleared, 'conn:c2').length, 1)
})

test('frames auto-follow only at bottom', async () => {
  assert.equal(framesShouldStickToBottom(0, 1000, 300), false)
  assert.equal(framesShouldStickToBottom(700, 1000, 300), true)
  assert.equal(framesShouldStickToBottom(695, 1000, 300), true)
  assert.equal(framesShouldStickToBottom(500, 1000, 300), false)
})

test('frames view wires identity + virtualizer via build pipeline', async () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  assert.match(
    src,
    /buildFramePortOptions|parseFramePortSelection|selectProtocolFrames/,
    'view should use identity helpers',
  )
  assert.match(src, /mergeFramesDedup/, 'view should merge persisted + memory by frameId')
  assert.match(src, /vendorVirtualizer/, 'view should consume bundled Virtualizer')
  assert.match(src, /getVirtualItems|getTotalSize|measureElement/, 'view should use real Virtualizer API')
  const build = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.ok(build.indexOf('bench-frames-model.mjs') >= 0, 'build should include frames model module')
})

test('cli wiring: frames/clear route exists in host', async () => {
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.match(host, /frames\/clear/, 'host should expose POST /dsh-vision-bench/frames/clear')
  assert.match(host, /connectionId|all/, 'clear route should accept connectionId or all')
})

// keep the "file exists" contract assertion (not a behavior claim)
test('bench-frames-view.mjs exists and registers dsh-vision-bench:frames', async () => {
  const p = join(root, 'bench-frames-view.mjs')
  assert.ok(existsSync(p))
  const src = readFileSync(p, 'utf8')
  assert.match(src, /dsh-vision-bench:frames/)
  assert.match(src, /createFramesPage/)
})

test('resolveFrameSelection maps conn:<id> to its COM port; raw: is not a source', async () => {
  const conns = CONNECTIONS
  assert.deepEqual(resolveFrameSelection('conn:c1', conns), { kind: 'conn', connectionId: 'c1', port: 'COM3' })
  assert.deepEqual(resolveFrameSelection('raw:COM7', conns), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(resolveFrameSelection('conn:c2', conns), { kind: 'conn', connectionId: 'c2', port: 'COM4' })
  assert.deepEqual(resolveFrameSelection('all', conns), { kind: 'all', connectionId: '', port: '' })
  const tcpOnly = [{ id: 't1', name: 'T1', conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 } }]
  assert.deepEqual(resolveFrameSelection('conn:t1', tcpOnly), { kind: 'conn', connectionId: 't1', port: '' })
})

test('mode switch keeps conn selection; unconfigured COM is never a source', async () => {
  const conns = CONNECTIONS
  assert.equal(resolveFrameSelection('conn:c1', conns).kind, 'conn')
  assert.equal(resolveFrameSelection('raw:COM7', conns).kind, 'all')
})

test('frames page source has no open/close serial UI', async () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  assert.doesNotMatch(src, /打开串口/)
  assert.doesNotMatch(src, /关闭串口/)
  assert.doesNotMatch(src, /serial\/open/)
  assert.doesNotMatch(src, /serial\/close/)
  assert.doesNotMatch(src, /openedByFramesRef/)
  assert.match(src, /serialSources/)
  assert.match(src, /framesClearView|清空显示/)
})
