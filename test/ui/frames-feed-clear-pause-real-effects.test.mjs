import assert from 'node:assert/strict'
// Frames clear-view + pause/connection-switch lifecycle (HappyDOM + react-runtime).
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createFramesPage } from '../../bench-frames-view.mjs'
import { pushFramesLog } from '../../bench-shared.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'
import {
  RTU_C1,
  RTU_C2,
  SOURCE_C1,
  SOURCE_C2,
  framesStatePayload,
  makeFrames,
  withNullVendor,
} from '../helpers/real-effects-fixtures.mjs'

useReactPageRuntime({ profile: 'virtualized' })

test('清空显示 only resets the page view and does not post frames/clear or close COM', async () => {
  await withNullVendor(async () => {
    const holder = { frames: { c1: makeFrames('c1', 3) } }
    const clearCalls = []
    const closeCalls = []
    const memOnly = {
      frameId: 'mem-x',
      connectionId: 'c1',
      deviceId: 'd1',
      t: 900,
      at: 900,
      direction: 'tx',
      request: 'MEM',
      label: 'MEM',
      status: 'ok',
    }
    const post = async (path) => {
      if (path === '/dsh-vision-bench/state') {
        return framesStatePayload({ frames: holder.frames, connections: [RTU_C1], serialSources: [SOURCE_C1] })
      }
      if (path === '/dsh-vision-bench/frames/clear') {
        clearCalls.push(path)
        return { ok: true }
      }
      if (path === '/dsh-vision-bench/serial/close' || path === '/dsh-vision-bench/connection/close') {
        closeCalls.push(path)
        return { ok: true }
      }
      return { ok: true }
    }
    const tmap = (k) => ({ serialPause: '暂停', serialResume: '恢复', framesClearView: '清空显示' })[k] || k
    pushFramesLog({ cwd: '/tmp/p6', sessionId: 's1' }, 'c1', [memOnly])
    const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
    const tree = render(
      createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/p6' }), scope: { cwd: '/tmp/p6' } }),
    )
    await waitFor(
      () => {
        const rows = tree.container.querySelectorAll('.dvb-live-row')
        assert.equal(rows.length, 4, 'persisted 3 + memory 1 rendered')
      },
      { timeout: 8000 },
    )
    await act(async () => {
      tree.container.querySelector('[data-action="pause"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    })
    assert.equal(
      tree.container.querySelector('[data-action="pause"]')?.getAttribute('aria-checked'),
      'false',
      'paused before clear',
    )
    await act(async () => {
      Array.from(tree.container.querySelectorAll('button'))
        .find((b) => b.textContent === '清空显示')
        .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 80))
    })
    await waitFor(
      () => {
        assert.equal(tree.container.querySelectorAll('.dvb-live-row').length, 0, 'cleared view')
        assert.equal(
          tree.container.querySelector('[data-action="pause"]')?.getAttribute('aria-checked'),
          'true',
          'pause banner cleared after clear',
        )
      },
      { timeout: 6000 },
    )
    assert.deepEqual(clearCalls, [])
    assert.deepEqual(closeCalls, [])
    tree.unmount()
    await new Promise((r) => setTimeout(r, 150))
  })
})

test('Task7: switching connection while paused exits pause and shows only the new conn', async () => {
  await withNullVendor(async () => {
    const holder = { frames: { c1: makeFrames('c1', 3), c2: makeFrames('c2', 4, 100) } }
    const post = async (path) => {
      if (path === '/dsh-vision-bench/state') {
        return framesStatePayload({
          frames: holder.frames,
          connections: [RTU_C1, RTU_C2],
          serialSources: [SOURCE_C1, SOURCE_C2],
        })
      }
      if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3', 'COM4'] }
      return { ok: true }
    }
    const tmap = (k) => ({ serialPause: '暂停', serialResume: '恢复' })[k] || k
    const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
    const tree = render(
      createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/p7' }), scope: { cwd: '/tmp/p7' } }),
    )
    await waitFor(
      () => {
        assert.ok(tree.container.querySelectorAll('.dvb-live-row').length > 0)
      },
      { timeout: 8000 },
    )
    await act(async () => {
      const sel = Array.from(tree.container.querySelectorAll('select'))[0]
      sel.value = 'conn:c1'
      sel.dispatchEvent(new win.Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    })
    await waitFor(
      () => {
        const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
          el.getAttribute('data-frameid'),
        )
        assert.ok(ids.length === 3 && ids.every((id) => id.startsWith('c1-')), 'c1 frames only')
      },
      { timeout: 6000 },
    )
    await act(async () => {
      tree.container.querySelector('[data-action="pause"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    })
    assert.equal(tree.container.querySelector('[data-action="pause"]')?.getAttribute('aria-checked'), 'false')
    await act(async () => {
      const sel = Array.from(tree.container.querySelectorAll('select'))[0]
      sel.value = 'conn:c2'
      sel.dispatchEvent(new win.Event('change', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 80))
    })
    await waitFor(
      () => {
        const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
          el.getAttribute('data-frameid'),
        )
        assert.ok(
          ids.length === 4 && ids.every((id) => id.startsWith('c2-')),
          'only c2 frames after switch: ' + ids.slice(0, 5),
        )
        assert.equal(
          tree.container.querySelector('[data-action="pause"]')?.getAttribute('aria-checked'),
          'true',
          'pause exited on connection switch',
        )
        assert.ok(!ids.some((id) => id.startsWith('c1-')), 'no c1 residue')
      },
      { timeout: 6000 },
    )
    tree.unmount()
  })
})
