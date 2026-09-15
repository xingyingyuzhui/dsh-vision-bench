// @ts-check
/** Shared fixtures for project-workspace suites (P2-5). */
import assert from 'node:assert/strict'
import { act, waitFor } from '@testing-library/react'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win } from './react-runtime.mjs'

export const MAP_DETAILS = {
  target: 'Debug',
  counts: { files: 2, includes: 0, include_edges: 0 },
  groups: [
    {
      name: 'Source',
      files: [
        {
          name: 'main.c',
          rel: 'src/main.c',
          inside: true,
          exists: true,
          readable: true,
          functions: [{ name: 'main', line: 1 }],
        },
        {
          name: 'other.c',
          rel: 'src/other.c',
          inside: true,
          exists: true,
          readable: true,
          functions: [],
        },
      ],
    },
  ],
  includes: [],
  defines: [],
  include_edges: [],
}

export const MAP_DETAILS_B = {
  ...MAP_DETAILS,
  target: 'Release',
  groups: [
    {
      name: 'Source',
      files: [
        {
          name: 'release.c',
          rel: 'src/release.c',
          inside: true,
          exists: true,
          readable: true,
          functions: [],
        },
      ],
    },
  ],
}

export function t(key) {
  return (
    {
      projectMap: '工程结构',
      mapTruncated: '已截断',
      loadFail: '加载失败',
      needWorkspace: '无工作区',
      projectMapEmpty: '空',
      opening: '打开中',
      csvCancel: '关闭',
    }[key] || key
  )
}

export function workspaceProps(sessionId, path) {
  return {
    ...alpha3PageProps({
      sessionId,
      path,
      useWorkspaces: (select) =>
        typeof select === 'function'
          ? select({ items: [{ path, sessionIds: [sessionId] }] })
          : { items: [{ path, sessionIds: [sessionId] }] },
    }),
  }
}

export function makeDeferredPost(handlers = {}) {
  const pending = { map: [], file: [] }
  let mapCall = 0
  const post = async (path, body) => {
    if (/\/dsh-vision-bench\/keil\/map$/.test(path)) {
      if (handlers.map) return handlers.map(body, pending)
      mapCall += 1
      const n = mapCall
      return new Promise((resolve) => {
        pending.map.push({ body, resolve, n })
      })
    }
    if (/\/dsh-vision-bench\/project\/file$/.test(path)) {
      if (handlers.file) return handlers.file(body, pending)
      return new Promise((resolve) => {
        pending.file.push({ body, resolve })
      })
    }
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      const keil =
        typeof handlers.keil === 'function'
          ? handlers.keil(body)
          : handlers.keil || { project: '/proj/x.uvprojx', target: 'Debug' }
      return {
        ok: true,
        workspace: {
          keil,
          journal: { tasks: [], running: [], timeline: [] },
          modbus: { version: 3, connections: [], devices: [], points: [], values: [], alarmState: {} },
        },
      }
    }
    return { ok: true }
  }
  return { post, pending }
}

export async function waitForMapPending(pending) {
  await waitFor(() => assert.ok(pending.map.length >= 1), { timeout: 6000 })
}

export function resolveMap(pending, details = MAP_DETAILS) {
  const item = pending.map.shift()
  assert.ok(item, 'expected pending map request')
  item.resolve({ ok: true, result: { details } })
}

export function resolveFile(pending, rel, text) {
  const item = pending.file.shift()
  assert.ok(item, 'expected pending file request')
  item.resolve({ ok: true, rel, text, lines: 1, truncated: false })
}

export async function bootMap(tree, pending, details = MAP_DETAILS) {
  await waitForMapPending(pending)
  await act(async () => {
    resolveMap(pending, details)
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })
}

export function fileButton(tree, name) {
  return Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find((b) => b.textContent === name)
}

export async function clickFile(tree, name) {
  const btn = fileButton(tree, name)
  assert.ok(btn, `expected file button ${name}`)
  await act(async () => {
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
}

export function buttonByText(tree, text) {
  return Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === text)
}

export const PREVIEW_EMPTY = '在左侧选择文件以预览源码'

export async function switchToGraph(tree) {
  const btn = buttonByText(tree, '图谱')
  assert.ok(btn, 'graph toggle present')
  await act(async () => {
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-graph-toolbar')), { timeout: 6000 })
}

export function graphHints(tree) {
  return Array.from(tree.container.querySelectorAll('.dvb-graph-toolbar .dvb-hint.dvb-need')).map((n) => n.textContent)
}

export { win }
