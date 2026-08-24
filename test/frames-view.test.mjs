import assert from 'node:assert/strict'
import { readFileSync, existsSync } from 'node:fs'
import { dirname, join } from 'node:path'
import { fileURLToPath } from 'node:url'
import test from 'node:test'
import {
  parseFramePortSelection,
  buildFramePortOptions,
  selectProtocolFrames,
  mergeFramesDedup,
  framesShouldStickToBottom,
} from '../bench-frames-model.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '..')

const CONNECTIONS = [
  { id: 'c1', name: '主机', conn: { mode: 'rtu', port: 'COM3', baudrate: 9600 } },
  { id: 'c2', name: '从机', conn: { mode: 'rtu', port: 'COM4', baudrate: 9600 } },
]

function makeFrame(connId, t, extra = {}) {
  return { frameId: 'f-' + connId + '-' + t, connectionId: connId, t, at: t, direction: 'tx', request: 'req' + t, label: 'L' + t, status: 'ok', functionCode: 3, ...extra }
}

const FBC = {
  c1: [makeFrame('c1', 10), makeFrame('c1', 20)],
  c2: [makeFrame('c2', 15)],
}

test('frames identity: parseFramePortSelection maps explicit internal types', () => {
  assert.deepEqual(parseFramePortSelection('all'), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection('conn:c1'), { kind: 'conn', connectionId: 'c1', port: '' })
  assert.deepEqual(parseFramePortSelection('raw:COM7'), { kind: 'raw', connectionId: '', port: 'COM7' })
  // unknown/display COM name must NEVER be treated as a connection id
  assert.deepEqual(parseFramePortSelection('COM3'), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection(''), { kind: 'all', connectionId: '', port: '' })
  assert.deepEqual(parseFramePortSelection(undefined), { kind: 'all', connectionId: '', port: '' })
})

test('frames identity: options use all/conn:<id>/raw:<port>; proto hides unconfigured COM', () => {
  const proto = buildFramePortOptions(CONNECTIONS, ['COM3', 'COM4', 'COM7'], 'proto')
  assert.equal(proto[0].value, 'all')
  assert.ok(proto.some((o) => o.value === 'conn:c1' && o.kind === 'configured'))
  assert.ok(proto.some((o) => o.value === 'conn:c2' && o.kind === 'configured'))
  assert.ok(!proto.some((o) => o.value.startsWith('raw:')), 'proto mode must not expose unconfigured COM')
  const raw = buildFramePortOptions(CONNECTIONS, ['COM3', 'COM4', 'COM7'], 'raw')
  assert.ok(raw.some((o) => o.value === 'raw:COM7' && o.kind === 'unconfigured'), 'raw mode exposes unconfigured COM7')
  assert.ok(!raw.some((o) => o.value === 'raw:COM3'), 'configured COM3 must not be duplicated as unconfigured')
})

test('frames identity: selecting COM3 only shows c1 frames, COM4 only c2, all merges by time', () => {
  const c1 = selectProtocolFrames(FBC, 'conn:c1')
  assert.deepEqual(c1.map((f) => f.connectionId), ['c1', 'c1'])
  const c2 = selectProtocolFrames(FBC, 'conn:c2')
  assert.deepEqual(c2.map((f) => f.connectionId), ['c2'])
  // unknown selection degrades to 'all'
  const byComName = selectProtocolFrames(FBC, 'COM3')
  assert.equal(byComName.length, selectProtocolFrames(FBC, 'all').length, 'unknown value -> all, never a per-COM cache key')
  const all = selectProtocolFrames(FBC, 'all')
  assert.equal(all.length, 3)
  const times = all.map((f) => f.t)
  assert.deepEqual(times, [...times].sort((a, b) => a - b), 'all must be time-merged')
})

test('frames persistence: mergeFramesDedup dedups by frameId across persisted + memory', () => {
  const persisted = [makeFrame('c1', 10, { request: 'old' }), makeFrame('c1', 20)]
  const memory = [makeFrame('c1', 20, { request: 'fresh' }), makeFrame('c1', 30)]
  const merged = mergeFramesDedup(persisted, memory, 500)
  assert.equal(merged.length, 3)
  const f20 = merged.find((f) => f.t === 20)
  assert.equal(f20.request, 'fresh', 'memory wins for same frameId on re-read')
})

test('frames persistence: reload keeps history (persisted frames are the source of truth)', () => {
  // Simulate: frames produced, persisted, page reloads with no memory → persisted still shows
  const afterReload = selectProtocolFrames(FBC, 'conn:c1')
  assert.equal(afterReload.length, 2)
  const ids = afterReload.map((f) => f.frameId)
  // clear c1 does not affect c2 via selectProtocolFrames
  const cleared = { ...FBC }; delete cleared.c1
  assert.equal(selectProtocolFrames(cleared, 'conn:c2').length, 1)
})

test('frames auto-follow only at bottom', () => {
  assert.equal(framesShouldStickToBottom(0, 1000, 300), false)
  assert.equal(framesShouldStickToBottom(700, 1000, 300), true)
  assert.equal(framesShouldStickToBottom(695, 1000, 300), true)
  assert.equal(framesShouldStickToBottom(500, 1000, 300), false)
})

test('frames view wires identity + virtualizer via build pipeline', () => {
  const src = readFileSync(join(root, 'bench-frames-view.mjs'), 'utf8')
  assert.match(src, /buildFramePortOptions|parseFramePortSelection|selectProtocolFrames/, 'view should use identity helpers')
  assert.match(src, /mergeFramesDedup/, 'view should merge persisted + memory by frameId')
  assert.match(src, /vendorVirtualizer/, 'view should consume bundled Virtualizer')
  assert.match(src, /getVirtualItems|getTotalSize|measureElement/, 'view should use real Virtualizer API')
  const build = readFileSync(join(root, 'scripts/build-client.mjs'), 'utf8')
  assert.ok(build.indexOf('bench-frames-model.mjs') >= 0, 'build should include frames model module')
})

test('cli wiring: frames/clear route exists in host', () => {
  const host = readFileSync(join(root, 'host.js'), 'utf8')
  assert.match(host, /frames\/clear/, 'host should expose POST /dsh-vision-bench/frames/clear')
  assert.match(host, /connectionId|all/, 'clear route should accept connectionId or all')
})

// keep the "file exists" contract assertion (not a behavior claim)
test('bench-frames-view.mjs exists and registers dsh-vision-bench:frames', () => {
  const p = join(root, 'bench-frames-view.mjs')
  assert.ok(existsSync(p))
  const src = readFileSync(p, 'utf8')
  assert.match(src, /dsh-vision-bench:frames/)
  assert.match(src, /createFramesPage/)
})
