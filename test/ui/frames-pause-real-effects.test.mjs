import assert from 'node:assert/strict'
// Pause/resume freezes Frames content (HappyDOM + react-runtime).
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createFramesPage } from '../../bench-frames-view.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'
import {
  framesStatePayload,
  framesT as t,
  makeFrames,
  withNullVendor,
} from '../helpers/real-effects-fixtures.mjs'

useReactPageRuntime({ profile: 'virtualized' })

test('Task8: pause freezes content (ids/text identical), resume shows live frames', async () => {
  await withNullVendor(async () => {
    const holder = { frames: { c1: makeFrames('c1', 12, 1) } }
    const post = async (path) => {
      if (path === '/dsh-vision-bench/state') {
        return framesStatePayload({
          frames: holder.frames,
          connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
          serialSources: undefined,
        })
      }
      if (path === '/dsh-vision-bench/serial/ports') return { ok: true, ports: ['COM3'] }
      return { ok: true }
    }
    // Force FALLBACK row path (deterministic DOM rows) — pause lifecycle asserts real content.
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
    holder.frames = { c1: makeFrames('c1', 30, 1) }
    await waitFor(
      () => {
        const rows = tree.container.querySelectorAll('.dvb-live-row')
        assert.ok(rows.length > rowsAtRest, 'display follows live growth: ' + rows.length + ' > ' + rowsAtRest)
      },
      { timeout: 5000 },
    )
    await act(async () => {
      tree.container.querySelector('[data-action="pause"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 60))
    })
    const pausedIds = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
      el.getAttribute('data-frameid'),
    )
    const pausedText = tree.container.querySelector('.dvb-frames-virtual').textContent
    holder.frames = { c1: makeFrames('c1', 40, 1) }
    await new Promise((r) => setTimeout(r, 1900))
    const stillPausedIds = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
      el.getAttribute('data-frameid'),
    )
    const stillPausedText = tree.container.querySelector('.dvb-frames-virtual').textContent
    assert.deepEqual(stillPausedIds, pausedIds, 'paused content ids are frozen')
    assert.equal(stillPausedText, pausedText, 'paused content text is frozen')
    const pauseBtn = tree.container.querySelector('[data-action="pause"]')
    assert.equal(pauseBtn?.getAttribute('aria-checked'), 'false', 'paused switch is off')
    assert.equal(pauseBtn?.getAttribute('title'), '恢复', 'paused switch title is resume')
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
  })
})
