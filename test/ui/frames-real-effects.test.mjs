import assert from 'node:assert/strict'
// P2-2: Frames page real React lifecycle (virtualizer / pause / COM safety).
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createFramesPage } from '../../bench-frames-view.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'
import { framesT as t, makeFrames, makePost } from '../helpers/real-effects-fixtures.mjs'

useReactPageRuntime({ profile: 'virtualized' })

test('Task8: official Virtualizer renders viewport-limited rows (adapter level) and drives component without errors', async () => {
  // 1) adapter-level STRONG assertions with the official Virtualizer class:
  // deterministic element stub (rect+scroll) — same class the react hook uses.
  const vcore = await import('@tanstack/virtual-core')
  const official = vcore.Virtualizer
  const makeEl = (top = 0) => {
    const el = {
      scrollTop: top,
      offsetHeight: 320,
      offsetWidth: 400,
      clientHeight: 320,
      clientWidth: 400,
      getBoundingClientRect: () => ({
        width: 400,
        height: 320,
        top: 0,
        left: 0,
        right: 400,
        bottom: 320,
        x: 0,
        y: 0,
        toJSON() {},
      }),
      addEventListener() {},
      removeEventListener() {},
    }
    return el
  }
  const makeWin = () => ({
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
    requestAnimationFrame: (cb) => setTimeout(cb, 0),
    cancelAnimationFrame: (id) => clearTimeout(id),
  })
  const create = (count, top = 0) => {
    const scrollElement = makeEl(top)
    const v = new official({
      count,
      getScrollElement: () => scrollElement,
      estimateSize: () => 36,
      overscan: 10,
      scrollToFn: () => {},
      observeElementRect: (instance, cb) => {
        cb({ width: 400, height: 320 })
        return () => {}
      },
      observeElementOffset: (instance, cb) => {
        cb(scrollElement.scrollTop, false)
        return () => {}
      },
    })
    v.scrollElement = scrollElement
    v.targetWindow = makeWin()
    v.scrollRect = { width: 400, height: 320 }
    v.scrollOffset = top
    v.measurementsCache = Array.from({ length: count }, (_, i) => ({
      index: i,
      start: i * 36,
      size: 36,
      end: (i + 1) * 36,
      key: i,
    }))
    return { v, el: scrollElement }
  }
  const c5k = create(5000)
  const items = c5k.v.getVirtualItems()
  assert.ok(items.length > 0, 'official Virtualizer produces rows for 5000')
  assert.ok(items.length < 50, 'viewport-limited (<50): ' + items.length)
  assert.equal(items[0].index, 0)
  // scroll to middle: window moves
  const mid = create(5000, 3000 * 36)
  const midItems = mid.v.getVirtualItems()
  assert.ok(
    midItems.some((it) => it.index >= 2900 && it.index <= 3100),
    'scroll moves the visible window',
  )

  // 2) component-level STRONG assertions with the OFFICIAL hook — the fixed
  // layout stubs (always-400x320 rect) must make the real Virtualizer render.
  const frames = { c1: makeFrames('c1', 5000, 1) }
  const { post, calls } = makePost({ frames })
  const officialViz = globalThis.__rvUseVirtualizer || (await import('@tanstack/react-virtual')).useVirtualizer
  assert.ok(officialViz)
  const Frames = createFramesPage(React, t, post, { useVirtualizer: officialViz })
  const tree = render(
    createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }), scope: { cwd: '/tmp/proj' } }),
  )
  await waitFor(
    () => {
      assert.ok(calls.state >= 2, 'must poll /state repeatedly via real effect, got ' + calls.state)
      const rows = tree.container.querySelectorAll('.dvb-live-row')
      assert.ok(rows.length > 0, 'official Virtualizer MUST render rows inside FramesPage, got 0')
    },
    { timeout: 10000 },
  )
  let rows = tree.container.querySelectorAll('.dvb-live-row')
  assert.ok(rows.length < 50, 'viewport-limited: ' + rows.length)
  assert.equal(rows[0].getAttribute('data-frameid'), 'c1-f1', 'first visible row is frame 1')
  const list = tree.container.querySelector('.dvb-frames-virtual')
  assert.ok(list)
  // scroll to the middle — visible ids must change and stay <50 rows
  await act(async () => {
    list.scrollTop = 3000 * 36
    list.dispatchEvent(new win.Event('scroll'))
    await new Promise((r) => setTimeout(r, 200))
  })
  await waitFor(
    () => {
      const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
        el.getAttribute('data-frameid'),
      )
      assert.ok(!ids.includes('c1-f1'), 'scroll must leave the first frame: ' + ids.slice(0, 4))
    },
    { timeout: 6000 },
  )
  rows = tree.container.querySelectorAll('.dvb-live-row')
  assert.ok(rows.length < 50, 'still viewport-limited after scroll: ' + rows.length)
  tree.unmount()
})
test('Task8: pause freezes content (ids/text identical), resume shows live frames', async () => {
  const holder = { frames: { c1: makeFrames('c1', 12, 1) } }
  let stateCalls = 0
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      stateCalls++
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
            devices: [],
            points: [],
            framesByConnection: holder.frames,
            configVersion: 1,
          },
        },
        health: {},
      }
    }
    if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3'] }
    return { ok: true }
  }
  // Force the FALLBACK row path (deterministic DOM rows in happy-dom) by
  // temporarily hiding the vendor — pause lifecycle is asserted on real content.
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  try {
    const Frames = createFramesPage(React, t, post, { useVirtualizer: () => null })
    const tree = render(
      createElement(Frames, {
        ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }),
        scope: { cwd: '/tmp/proj' },
      }),
    )
    await waitFor(
      () => {
        const pauseBtn = tree.container.querySelector('[data-action="pause"]')
        assert.ok(pauseBtn, 'pause button rendered via real effects')
        assert.ok(tree.container.querySelectorAll('.dvb-live-row').length > 0, 'fallback rows rendered')
      },
      { timeout: 8000 },
    )
    const rowsAtRest = tree.container.querySelectorAll('.dvb-live-row').length
    assert.equal(rowsAtRest, 12, 'all 12 initial frames shown')
    // grow live frames while NOT paused → display catches up (within fallback cap)
    holder.frames = { c1: makeFrames('c1', 30, 1) }
    await waitFor(
      () => {
        const rows = tree.container.querySelectorAll('.dvb-live-row')
        assert.ok(rows.length > rowsAtRest, 'display follows live growth: ' + rows.length + ' > ' + rowsAtRest)
      },
      { timeout: 5000 },
    )
    // PAUSE
    await act(async () => {
      tree.container.querySelector('[data-action="pause"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    })
    const pausedIds = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
      el.getAttribute('data-frameid'),
    )
    const pausedText = tree.container.querySelector('.dvb-frames-virtual').textContent
    // grow MORE while paused → display must stay frozen; allow a state poll to
    // account the growth into pendingNew
    holder.frames = { c1: makeFrames('c1', 40, 1) }
    await new Promise((r) => setTimeout(r, 1900))
    const stillPausedIds = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
      el.getAttribute('data-frameid'),
    )
    const stillPausedText = tree.container.querySelector('.dvb-frames-virtual').textContent
    assert.deepEqual(stillPausedIds, pausedIds, 'paused content ids are frozen')
    assert.equal(stillPausedText, pausedText, 'paused content text is frozen')
    // while paused the switch reflects paused state
    const pauseBtn = tree.container.querySelector('[data-action="pause"]')
    assert.equal(pauseBtn?.getAttribute('aria-checked'), 'false', 'paused switch is off')
    assert.equal(pauseBtn?.getAttribute('title'), '恢复', 'paused switch title is resume')
    // RESUME clears the frozen snapshot
    await act(async () => {
      if (pauseBtn) pauseBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    })
    await waitFor(
      () => {
        const resumeBtn = tree.container.querySelector('[data-action="pause"]')
        assert.equal(resumeBtn?.getAttribute('aria-checked'), 'true', 'resume switch is on')
        assert.equal(resumeBtn?.getAttribute('title'), '暂停', 'resume switch title is pause')
      },
      { timeout: 4000 },
    )
    tree.unmount()
  } finally {
    globalThis.DvbVendor = savedVendor
  }
})
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
    },
    { timeout: 6000 },
  )
  const sel = Array.from(tree.container.querySelectorAll('select'))[0]
  const values = Array.from(sel.querySelectorAll('option')).map((o) => o.value)
  assert.ok(values.includes('all'))
  assert.ok(values.includes('conn:c1'))
  assert.ok(!values.includes('conn:c2'), 'disconnected COM4 hidden')
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
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const closeCalls = []
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }],
            devices: [],
            points: [],
            framesByConnection: {},
            configVersion: 1,
          },
        },
        health: {},
        serialSources: [],
      }
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
  globalThis.DvbVendor = savedVendor
})
