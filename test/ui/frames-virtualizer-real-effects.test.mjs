import assert from 'node:assert/strict'
// Official Virtualizer viewport limits (HappyDOM + react-runtime).
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
  const mid = create(5000, 3000 * 36)
  const midItems = mid.v.getVirtualItems()
  assert.ok(
    midItems.some((it) => it.index >= 2900 && it.index <= 3100),
    'scroll moves the visible window',
  )

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
