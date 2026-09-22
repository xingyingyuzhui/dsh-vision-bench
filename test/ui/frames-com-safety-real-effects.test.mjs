import assert from 'node:assert/strict'
// Frames COM safety: no open/close, source list, empty CTA (HappyDOM + react-runtime).
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createFramesPage } from '../../bench-frames-view.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'
import {
  RTU_C1,
  framesStatePayload,
  framesT as t,
  makeFrames,
  makePost,
  withNullVendor,
} from '../helpers/real-effects-fixtures.mjs'

useReactPageRuntime({ profile: 'virtualized' })

test('frames page has no open/close serial buttons in proto or raw', async () => {
  const { post, calls } = makePost({ frames: { c1: makeFrames('c1', 3) } })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(
    createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }), scope: { cwd: '/tmp/proj' } }),
  )
  await waitFor(
    () => {
      assert.ok(calls.state >= 1)
    },
    { timeout: 5000 },
  )
  const labels = Array.from(tree.container.querySelectorAll('button')).map((b) => b.textContent)
  assert.ok(!labels.includes('打开串口'))
  assert.ok(!labels.includes('关闭串口'))
  await act(async () => {
    const rawBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '原始数据')
    assert.ok(rawBtn, 'raw mode button exists')
    rawBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  const after = Array.from(tree.container.querySelectorAll('button')).map((b) => b.textContent)
  assert.ok(!after.includes('打开串口'))
  assert.ok(!after.includes('关闭串口'))
  tree.unmount()
})

test('unmounting frames page never opens or closes a COM', async () => {
  const { post, calls, closeCalls, openCalls } = makePost({ frames: { c1: makeFrames('c1', 3) } })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(
    createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }), scope: { cwd: '/tmp/proj' } }),
  )
  await waitFor(
    () => {
      assert.ok(calls.state >= 1)
    },
    { timeout: 6000 },
  )
  tree.unmount()
  assert.equal(closeCalls.length, 0, 'unmount must not close HMI connections')
  assert.equal(openCalls.length, 0, 'frames page must not open a port')
})

test('live source list only includes connected RTU, never unconfigured COM', async () => {
  const frames = { c1: makeFrames('c1', 3) }
  const { post, calls } = makePost({
    frames,
    connections: [
      { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
      { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } },
    ],
    serialSources: [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }],
  })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(
    createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }), scope: { cwd: '/tmp/proj' } }),
  )
  await waitFor(
    () => {
      assert.ok(calls.state >= 1)
      const sel = Array.from(tree.container.querySelectorAll('select'))[0]
      assert.ok(sel, 'select exists')
      const values = Array.from(sel.querySelectorAll('option')).map((o) => o.value)
      assert.ok(values.includes('conn:c1'))
      // Readiness sentinel must be payload-only state: the empty normalized
      // topology synthesizes a placeholder connection `c1` (connection-model),
      // so `conn:c1` is already in the DOM before any /state payload lands and
      // `calls.state` only counts the POST. `conn:c2` can only come from the
      // delivered payload — waiting for it keeps the assertions below from
      // racing the async state delivery/re-render on slow CI.
      assert.ok(values.includes('conn:c2'), 'state payload applied: proto lists disconnected configured COM4')
    },
    { timeout: 6000 },
  )
  // Protocol mode lists every configured connection (including disconnected).
  let sel = Array.from(tree.container.querySelectorAll('select'))[0]
  let values = Array.from(sel.querySelectorAll('option')).map((o) => o.value)
  assert.ok(values.includes('all'))
  assert.ok(values.includes('conn:c1'))
  assert.ok(values.includes('conn:c2'), 'proto lists disconnected configured COM4')
  assert.ok(!values.some((v) => String(v).startsWith('raw:')), 'unconfigured COM hidden')
  await act(async () => {
    const rawBtn = Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === '原始数据')
    assert.ok(rawBtn, 'raw mode button exists')
    rawBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  // Raw mode only lists currently connected RTU sources.
  sel = Array.from(tree.container.querySelectorAll('select'))[0]
  values = Array.from(sel.querySelectorAll('option')).map((o) => o.value)
  assert.ok(values.includes('all'))
  assert.ok(values.includes('conn:c1'))
  assert.ok(!values.includes('conn:c2'), 'raw hides disconnected COM4')
  assert.ok(!values.some((v) => String(v).startsWith('raw:')), 'unconfigured COM hidden')
  tree.unmount()
})

test('switching proto/raw does not open or close a COM', async () => {
  const frames = { c1: makeFrames('c1', 3) }
  const { post, calls, openCalls, closeCalls } = makePost({ frames })
  const Frames = createFramesPage(React, t, post, {})
  const tree = render(
    createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }), scope: { cwd: '/tmp/proj' } }),
  )
  await waitFor(
    () => {
      assert.ok(calls.state >= 1)
    },
    { timeout: 6000 },
  )
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button'))
      .find((b) => b.textContent === '原始数据')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button'))
      .find((b) => b.textContent === '协议报文')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  assert.equal(openCalls.length, 0)
  assert.equal(closeCalls.length, 0)
  tree.unmount()
  assert.equal(closeCalls.length, 0)
})

test('empty live sources show no HMI CTA; closing the tab does not unlink', async () => {
  await withNullVendor(async () => {
    const closeCalls = []
    const post = async (path) => {
      if (path === '/dsh-vision-bench/state') {
        return framesStatePayload({
          frames: {},
          connections: [RTU_C1],
          serialSources: [],
        })
      }
      if (path === '/dsh-vision-bench/serial/close' || path === '/dsh-vision-bench/connection/close') {
        closeCalls.push(path)
        return { ok: true }
      }
      return { ok: true }
    }
    const tmap = (k) => ({ framesRaw: '原始数据', framesEmpty: '暂无报文' })[k] || k
    const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
    const tree = render(
      createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/p4' }), scope: { cwd: '/tmp/p4' } }),
    )
    await waitFor(
      () => {
        assert.ok(tree.container.textContent.includes('串口报文') || tree.container.querySelector('.dvb-frames-page'))
        assert.ok(!tree.container.textContent.includes('暂无已连接串口'))
        assert.ok(!tree.container.textContent.includes('请先在上位机中创建连接并连接串口'))
        assert.ok(!Array.from(tree.container.querySelectorAll('button')).some((b) => b.textContent === '前往上位机'))
      },
      { timeout: 6000 },
    )
    tree.unmount()
    assert.equal(closeCalls.length, 0)
  })
})
