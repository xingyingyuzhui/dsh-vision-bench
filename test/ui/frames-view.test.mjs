import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { createElement } from 'react'
import {
  buildFramePortOptions,
  framesShouldStickToBottom,
  mergeFramesDedup,
  parseFramePortSelection,
  resolveFrameSelection,
  selectProtocolFrames,
} from '../../bench-frames-model.mjs'
import * as framesFacade from '../../bench-frames-view.mjs'
import { createFramesPage, FRAMES_TAB_ID } from '../../src/ui/monitor/frames/frames-page.mjs'
import { VISION_HTTP_TO_RPC, VISION_RPC_ENDPOINTS } from '../../src/shared/vision-rpc-contract.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { render, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

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
  const afterReload = selectProtocolFrames(FBC, 'conn:c1')
  assert.equal(afterReload.length, 2)
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

test('cli wiring: frames/clear endpoint exists in RPC contract', () => {
  assert.equal(VISION_HTTP_TO_RPC['/dsh-vision-bench/frames/clear'], 'frames/clear')
  assert.ok(VISION_RPC_ENDPOINTS.includes('frames/clear'))
})

test('bench-frames-view.mjs re-exports createFramesPage', () => {
  assert.equal(typeof framesFacade.createFramesPage, 'function')
  assert.equal(framesFacade.createFramesPage, createFramesPage)
  assert.equal(framesFacade.FRAMES_TAB_ID, FRAMES_TAB_ID)
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

test('frames page UI exposes clear-display, not open/close serial controls', async () => {
  const t = (k) =>
    ({
      framesClearView: '清空显示',
      framesOpen: '打开串口',
      framesClose: '关闭串口',
    })[k] || k
  const post = async () => ({
    ok: true,
    workspace: {
      modbus: {
        version: 3,
        connections: CONNECTIONS,
        devices: [],
        points: [],
        values: [],
        framesByConnection: {},
      },
    },
  })
  const Page = createFramesPage(React, t, post)
  const tree = render(createElement(Page, alpha3PageProps({ sessionId: 's1', path: '/ws' })))
  const text = tree.container.textContent || ''
  assert.ok(text.includes('清空显示'), 'clear display control present')
  assert.equal(text.includes('打开串口'), false)
  assert.equal(text.includes('关闭串口'), false)
  assert.equal(tree.container.querySelector('[data-action="serial-open"]'), null)
  assert.equal(tree.container.querySelector('[data-action="serial-close"]'), null)
  tree.unmount()
})
