import assert from 'node:assert/strict'
// P2-2: Frames page real React lifecycle (virtualizer / pause / COM safety).
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createFramesPage } from '../../bench-frames-view.mjs'
import { pushFramesLog } from '../../bench-shared.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'
import { framesT as t, makeFrames, makePost } from '../helpers/real-effects-fixtures.mjs'

useReactPageRuntime({ profile: 'virtualized' })

test('raw feed identity stays on the selected connection; COM4 does not mix in', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const holder = {
    frames: { c1: makeFrames('c1', 3) },
    feedLines: [{ id: 1, epoch: 'e1', connectionId: 'c1', port: 'COM3', at: 1, hex: '01', direction: 'tx' }],
  }
  const openCalls = []
  const post = async (path, body) => {
    if (path === '/dsh-vision-bench/state') {
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            connections: [
              { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
              { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } },
            ],
            devices: [],
            points: [],
            framesByConnection: holder.frames,
            configVersion: 1,
          },
        },
        health: {},
        serialSources: [
          { connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' },
          { connectionId: 'c2', port: 'COM4', state: 'connected', name: 'C2' },
        ],
      }
    }
    if (path === '/dsh-vision-bench/serial/open') {
      openCalls.push(body)
      return { ok: false }
    }
    if (path === '/dsh-vision-bench/serial/feed') {
      const cid = body && body.connectionId
      const lines =
        cid === 'c2'
          ? [{ id: 9, epoch: 'e2', connectionId: 'c2', port: 'COM4', at: 2, hex: '04', direction: 'rx' }]
          : holder.feedLines
      return { ok: true, open: true, error: '', lastId: 1, lines }
    }
    return { ok: true }
  }
  const tmap = (k) => ({ framesRaw: '原始数据', serialPause: '暂停' })[k] || k
  const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
  const tree = render(
    createElement(Frames, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/p3' }), scope: { cwd: '/tmp/p3' } }),
  )
  await waitFor(
    () => {
      assert.ok(
        Array.from(tree.container.querySelectorAll('button')).some((b) => b.textContent === '原始数据'),
        'raw button',
      )
    },
    { timeout: 6000 },
  )
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button'))
      .find((b) => b.textContent === '原始数据')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(
    () => {
      const sel = Array.from(tree.container.querySelectorAll('select'))[0]
      assert.ok(
        Array.from(sel.querySelectorAll('option')).some((o) => o.value === 'conn:c1'),
        'conn:c1 option ready',
      )
    },
    { timeout: 6000 },
  )
  await act(async () => {
    const sel = Array.from(tree.container.querySelectorAll('select'))[0]
    sel.value = 'conn:c1'
    sel.dispatchEvent(new win.Event('change', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  assert.equal(openCalls.length, 0, 'raw mode must not open a port')
  const sel = Array.from(tree.container.querySelectorAll('select'))[0]
  assert.equal(sel.disabled, false, 'switching sources does not lock the connection')
  holder.feedLines = [{ id: 7, epoch: 'e1', connectionId: 'c1', port: 'COM3', at: 2, hex: 'AA', direction: 'rx' }]
  await waitFor(
    () => {
      const ids = Array.from(tree.container.querySelectorAll('.dvb-live-row')).map((el) =>
        el.getAttribute('data-frameid'),
      )
      assert.ok(
        ids.some((id) => String(id).includes('c1') && String(id).includes('7')),
        'raw identity uses c1: ' + ids.slice(0, 3),
      )
      assert.ok(!ids.some((id) => String(id).includes('c2') || String(id).includes('COM4')), 'no COM4 identity')
    },
    { timeout: 6000 },
  )
  tree.unmount()
  await new Promise((r) => setTimeout(r, 150))
  globalThis.DvbVendor = savedVendor
})
test('raw all-ports feed pages by lastId, never by wall-clock lastAt', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const feedBodies = []
  const now = Date.now()
  const post = async (path, body) => {
    if (path === '/dsh-vision-bench/state') {
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            connections: [
              { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
              { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } },
            ],
            devices: [],
            points: [],
            framesByConnection: {},
            configVersion: 1,
          },
        },
        health: {},
        serialSources: [
          { connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' },
          { connectionId: 'c2', port: 'COM4', state: 'connected', name: 'C2' },
        ],
      }
    }
    if (path === '/dsh-vision-bench/serial/feed') {
      feedBodies.push({ ...(body || {}) })
      const since = Number(body && body.since) || 0
      const all = [
        { id: 1, seq: 1, epoch: 'e', connectionId: 'c1', port: 'COM3', at: now, hex: '01', direction: 'tx' },
        { id: 2, seq: 2, epoch: 'e', connectionId: 'c2', port: 'COM4', at: now, hex: '02', direction: 'rx' },
      ]
      const lines = all.filter((l) => l.seq > since)
      return {
        ok: true,
        open: true,
        error: '',
        lastId: lines.length ? lines[lines.length - 1].seq : since,
        lines,
      }
    }
    return { ok: true }
  }
  const tmap = (k) => ({ framesRaw: '原始数据', serialPause: '暂停' })[k] || k
  const Frames = createFramesPage(React, tmap, post, { useVirtualizer: () => null })
  const tree = render(
    createElement(Frames, {
      ...alpha3PageProps({ sessionId: 's1', path: '/tmp/p-raw-cursor' }),
      scope: { cwd: '/tmp/p-raw-cursor' },
    }),
  )
  await waitFor(
    () => {
      assert.ok(
        Array.from(tree.container.querySelectorAll('button')).some((b) => b.textContent === '原始数据'),
        'raw button',
      )
    },
    { timeout: 6000 },
  )
  await act(async () => {
    Array.from(tree.container.querySelectorAll('button'))
      .find((b) => b.textContent === '原始数据')
      .dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(
    () => {
      assert.ok(feedBodies.length >= 1, 'raw mode pulls immediately')
    },
    { timeout: 4000 },
  )
  assert.equal(feedBodies[0].connectionId, '')
  assert.ok(Number(feedBodies[0].since) < 1000, 'first since is a seq cursor, not Date.now()')
  await waitFor(
    () => {
      assert.ok(feedBodies.length >= 2, 'second pull arrived')
      const since = Number(feedBodies[1].since)
      assert.ok(since >= 1 && since <= 2, 'later since follows lastId/seq, got ' + since)
    },
    { timeout: 4000 },
  )
  tree.unmount()
  globalThis.DvbVendor = savedVendor
})
test('清空显示 only resets the page view and does not post frames/clear or close COM', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
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
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } }],
            devices: [],
            points: [],
            framesByConnection: holder.frames,
            configVersion: 1,
          },
        },
        health: {},
        serialSources: [{ connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' }],
      }
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
  globalThis.DvbVendor = savedVendor
})
test('Task7: switching connection while paused exits pause and shows only the new conn', async () => {
  const savedVendor = globalThis.DvbVendor
  globalThis.DvbVendor = null
  const holder = { frames: { c1: makeFrames('c1', 3), c2: makeFrames('c2', 4, 100) } }
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state') {
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            connections: [
              { id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3' } },
              { id: 'c2', name: 'C2', conn: { mode: 'rtu', port: 'COM4' } },
            ],
            devices: [],
            points: [],
            framesByConnection: holder.frames,
            configVersion: 1,
          },
        },
        health: {},
        serialSources: [
          { connectionId: 'c1', port: 'COM3', state: 'connected', name: 'C1' },
          { connectionId: 'c2', port: 'COM4', state: 'connected', name: 'C2' },
        ],
      }
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
  // select c1
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
  // pause on c1
  await act(async () => {
    tree.container.querySelector('[data-action="pause"]').dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 60))
  })
  assert.equal(tree.container.querySelector('[data-action="pause"]')?.getAttribute('aria-checked'), 'false')
  // switch to c2 while paused → auto-exit pause, only c2 frameIds, no c1 residue
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
