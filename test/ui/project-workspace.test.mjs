import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, cleanup, fireEvent, render, waitFor } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { beginRequest, shouldApplyRequest } from '../../src/ui/common/latest-request-gate.mjs'
import { matchesIdentity, projectIdentityKey, tagMappedState } from '../../src/ui/debug/project/project-shared.mjs'
import { createProjectWorkspace } from '../../src/ui/debug/project/project-workspace.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'

let win
beforeEach(async () => {
  win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  try {
    globalThis.navigator = { clipboard: { writeText: async () => {} }, userAgent: 'happy' }
  } catch {
    Object.defineProperty(globalThis, 'navigator', {
      value: { clipboard: { writeText: async () => {} }, userAgent: 'happy' },
      configurable: true,
    })
  }
  globalThis.ResizeObserver = class {
    observe() {}
    unobserve() {}
    disconnect() {}
  }
  globalThis.Element = win.HTMLElement
  globalThis.HTMLElement = win.HTMLElement
  globalThis.requestAnimationFrame = (cb) => setTimeout(cb, 0)
  globalThis.cancelAnimationFrame = (id) => clearTimeout(id)
  globalThis.matchMedia = () => ({ matches: false, addEventListener() {}, removeEventListener() {} })
  globalThis.devicePixelRatio = 1
  globalThis.CustomEvent = win.CustomEvent
  globalThis.getComputedStyle = () => ({ getPropertyValue: () => '', setProperty() {}, removeProperty() {} })
  try {
    sessionStorage.clear()
  } catch {
    /* ignore */
  }
})
afterEach(() => {
  cleanup()
})

const MAP_DETAILS = {
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

const MAP_DETAILS_B = {
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

function t(key) {
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

function workspaceProps(sessionId, path) {
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

function makeDeferredPost(handlers = {}) {
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

async function waitForMapPending(pending) {
  await waitFor(() => assert.ok(pending.map.length >= 1), { timeout: 6000 })
}

function resolveMap(pending, details = MAP_DETAILS) {
  const item = pending.map.shift()
  assert.ok(item, 'expected pending map request')
  item.resolve({ ok: true, result: { details } })
}

function resolveFile(pending, rel, text) {
  const item = pending.file.shift()
  assert.ok(item, 'expected pending file request')
  item.resolve({ ok: true, rel, text, lines: 1, truncated: false })
}

async function bootMap(tree, pending, details = MAP_DETAILS) {
  await waitForMapPending(pending)
  await act(async () => {
    resolveMap(pending, details)
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })
}

function fileButton(tree, name) {
  return Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find((b) => b.textContent === name)
}

async function clickFile(tree, name) {
  const btn = fileButton(tree, name)
  assert.ok(btn, `expected file button ${name}`)
  await act(async () => {
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
}

function buttonByText(tree, text) {
  return Array.from(tree.container.querySelectorAll('button')).find((b) => b.textContent === text)
}

const PREVIEW_EMPTY = '在左侧选择文件以预览源码'

test('projectIdentityKey combines session, cwd, project and target', () => {
  const key = projectIdentityKey('s1', '/ws', { project: 'p.uvprojx', target: 'Debug' })
  assert.equal(key, ['s1', '/ws', 'p.uvprojx', 'Debug'].join('\0'))
  assert.notEqual(
    projectIdentityKey('s1', '/ws', { project: 'p.uvprojx', target: 'Debug' }),
    projectIdentityKey('s2', '/ws', { project: 'p.uvprojx', target: 'Debug' }),
  )
})

test('matchesIdentity rejects stale tagged state', () => {
  const key = projectIdentityKey('s1', '/ws', { project: 'p', target: 'Debug' })
  const mapped = tagMappedState(MAP_DETAILS, key)
  assert.equal(matchesIdentity(mapped, key), true)
  assert.equal(matchesIdentity(mapped, projectIdentityKey('s2', '/ws', { project: 'p', target: 'Debug' })), false)
})

test('shouldApplyRequest requires latest id, identity and mount', () => {
  const ref = { current: 2 }
  const mounted = { current: true }
  const id = 'a\0/ws\0p\0Debug'
  assert.equal(shouldApplyRequest(ref, 2, id, id, mounted), true)
  assert.equal(shouldApplyRequest(ref, 1, id, id, mounted), false)
  assert.equal(shouldApplyRequest(ref, 2, id, 'other', mounted), false)
  mounted.current = false
  assert.equal(shouldApplyRequest(ref, 2, id, id, mounted), false)
})

test('beginRequest increments monotonically', () => {
  const ref = { current: 0 }
  assert.equal(beginRequest(ref), 1)
  assert.equal(beginRequest(ref), 2)
})

test('切换工作区后旧源码预览立即不可见', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  let activePath = '/ws-a'
  const tree = render(createElement(Page, workspaceProps('s1', activePath)))
  await bootMap(tree, pending)

  const fileBtn = Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find(
    (b) => b.textContent === 'main.c',
  )
  await act(async () => {
    fileBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  await act(async () => {
    resolveFile(pending, 'src/main.c', 'int main(void) { return 0; }')
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('int main(void)')), { timeout: 6000 })

  activePath = '/ws-b'
  tree.rerender(createElement(Page, workspaceProps('s1', activePath)))
  assert.equal(tree.container.textContent.includes('int main(void)'), false)
  assert.ok(tree.container.textContent.includes('在左侧选择文件以预览源码'))
  tree.unmount()
})

test('相同 cwd 的 Session A/B 选择状态隔离', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const treeA = render(createElement(Page, workspaceProps('sA', '/shared')))
  await bootMap(treeA, pending)

  const fileBtnA = Array.from(treeA.container.querySelectorAll('.dvb-map-file-name')).find(
    (b) => b.textContent === 'main.c',
  )
  await act(async () => {
    fileBtnA.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  await act(async () => {
    resolveFile(pending, 'src/main.c', 'session-a-source')
  })
  await waitFor(() => assert.ok(treeA.container.textContent.includes('session-a-source')), { timeout: 6000 })

  const treeB = render(createElement(Page, workspaceProps('sB', '/shared')))
  await bootMap(treeB, pending)
  assert.equal(treeB.container.textContent.includes('session-a-source'), false)
  assert.ok(treeB.container.textContent.includes('在左侧选择文件以预览源码'))
  treeA.unmount()
  treeB.unmount()
})

test('工作区 1 的文件请求后返回不能覆盖工作区 2 的预览', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  let activePath = '/ws-1'
  const tree = render(createElement(Page, workspaceProps('s1', activePath)))
  await bootMap(tree, pending)

  const fileBtn = Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find(
    (b) => b.textContent === 'main.c',
  )
  await act(async () => {
    fileBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(pending.file.length >= 1), { timeout: 6000 })
  const staleFile = pending.file[0]

  activePath = '/ws-2'
  tree.rerender(createElement(Page, workspaceProps('s1', activePath)))
  await waitForMapPending(pending)
  await act(async () => {
    resolveMap(pending)
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('main.c')), { timeout: 6000 })

  const otherBtn = Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find(
    (b) => b.textContent === 'main.c',
  )
  await act(async () => {
    otherBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(pending.file.length >= 2), { timeout: 6000 })
  const freshFile = pending.file.at(-1)

  await act(async () => {
    freshFile.resolve({ ok: true, rel: 'src/main.c', text: 'workspace-two-source', lines: 1, truncated: false })
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('workspace-two-source')), { timeout: 6000 })

  await act(async () => {
    staleFile.resolve({ ok: true, rel: 'src/main.c', text: 'stale-workspace-one-source', lines: 1, truncated: false })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('stale-workspace-one-source'), false)
  assert.ok(tree.container.textContent.includes('workspace-two-source'))
  tree.unmount()
})

test('旧 map 请求后返回不能覆盖新 target 的 map', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  let activePath = '/ws-a'
  const tree = render(createElement(Page, workspaceProps('s1', activePath)))
  await waitForMapPending(pending)
  const stale = pending.map[0]

  activePath = '/ws-b'
  tree.rerender(createElement(Page, workspaceProps('s1', activePath)))
  await waitFor(() => assert.equal(pending.map.length, 2), { timeout: 6000 })
  const fresh = pending.map.at(-1)

  await act(async () => {
    fresh.resolve({ ok: true, result: { details: MAP_DETAILS_B } })
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('release.c')), { timeout: 6000 })

  await act(async () => {
    stale.resolve({ ok: true, result: { details: MAP_DETAILS } })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('release.c'), true)
  assert.equal(tree.container.textContent.includes('other.c'), false)
  tree.unmount()
})

test('旧请求结束时不能错误清除新请求的 busy', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  let activePath = '/ws-a'
  const tree = render(createElement(Page, workspaceProps('s1', activePath)))
  await waitForMapPending(pending)
  const stale = pending.map[0]

  activePath = '/ws-b'
  tree.rerender(createElement(Page, workspaceProps('s1', activePath)))
  await waitFor(() => assert.equal(pending.map.length, 2), { timeout: 6000 })
  const fresh = pending.map.at(-1)

  const opening = () => tree.container.textContent.includes('打开中')
  assert.equal(opening(), true)

  await act(async () => {
    stale.resolve({ ok: true, result: { details: MAP_DETAILS } })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(opening(), true, 'stale map finally must not clear busy for newer request')

  await act(async () => {
    fresh.resolve({ ok: true, result: { details: MAP_DETAILS } })
  })
  await waitFor(() => assert.equal(opening(), false), { timeout: 6000 })
  tree.unmount()
})

test('切换工作区后搜索、筛选、选中与跳转行全部复位', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  let activePath = '/ws-a'
  const tree = render(createElement(Page, workspaceProps('s1', activePath)))
  await bootMap(tree, pending)

  const searchInput = tree.container.querySelector('.dvb-map-search')
  await act(async () => {
    fireEvent.change(searchInput, { target: { value: 'main' } })
  })

  const fileBtn = Array.from(tree.container.querySelectorAll('.dvb-map-file-name')).find(
    (b) => b.textContent === 'main.c',
  )
  await act(async () => {
    fileBtn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  await act(async () => {
    resolveFile(pending, 'src/main.c', 'int main(void) { return 0; }')
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('int main(void)')), { timeout: 6000 })
  assert.ok(tree.container.querySelector('.dvb-map-file-row.is-on'))

  activePath = '/ws-b'
  tree.rerender(createElement(Page, workspaceProps('s1', activePath)))
  await waitForMapPending(pending)
  await act(async () => {
    resolveMap(pending)
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('Source')), { timeout: 6000 })

  const nextSearch = tree.container.querySelector('.dvb-map-search')
  const nextFilter = tree.container.querySelector('.dvb-map-filter')
  assert.equal(nextSearch.value, '')
  assert.equal(nextFilter.value, 'all')
  assert.equal(tree.container.querySelector('.dvb-map-file-row.is-on'), null)
  assert.equal(tree.container.textContent.includes('int main(void)'), false)
  tree.unmount()
})

// ---------------------------------------------------------------------------
// Phase 3 — async request isolation across identity changes
// ---------------------------------------------------------------------------

test('A 发起预览后切到无 Keil 的 B，A 的响应不得写入', async () => {
  const { post, pending } = makeDeferredPost({
    keil: (body) => (body?.cwd === '/ws-a' ? { project: '/proj/a.uvprojx', target: 'Debug' } : {}),
  })
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-a')))
  await bootMap(tree, pending)

  await clickFile(tree, 'main.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  const staleFile = pending.file.shift()
  const staleMaps = pending.map.splice(0)

  tree.rerender(createElement(Page, workspaceProps('s1', '/ws-b')))
  // B has no Keil project: the page must settle into the "no project" hint.
  await waitFor(() => assert.ok(tree.container.textContent.includes('空')), { timeout: 6000 })
  assert.ok(tree.container.textContent.includes(PREVIEW_EMPTY))

  // Any map request fired for B while A's keil was still hydrating is stale as well.
  const transitional = pending.map.splice(0)
  await act(async () => {
    staleFile.resolve({ ok: true, rel: 'src/main.c', text: 'stale-a-preview', lines: 1, truncated: false })
    for (const m of [...staleMaps, ...transitional]) m.resolve({ ok: true, result: { details: MAP_DETAILS } })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('stale-a-preview'), false)
  assert.equal(tree.container.textContent.includes('main.c'), false)
  assert.ok(tree.container.textContent.includes(PREVIEW_EMPTY))
  assert.equal(tree.container.textContent.includes('打开中'), false)
  tree.unmount()
})

test('A→B→A 往返后，A 的旧预览结果不得重新出现', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-a')))
  await bootMap(tree, pending)

  await clickFile(tree, 'main.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  const staleFile = pending.file.shift()

  tree.rerender(createElement(Page, workspaceProps('s1', '/ws-b')))
  await waitForMapPending(pending)
  pending.map.splice(0) // B never finishes loading

  tree.rerender(createElement(Page, workspaceProps('s1', '/ws-a')))
  await bootMap(tree, pending)
  assert.ok(tree.container.textContent.includes(PREVIEW_EMPTY))

  await act(async () => {
    staleFile.resolve({ ok: true, rel: 'src/main.c', text: 'first-visit-source', lines: 1, truncated: false })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('first-visit-source'), false)
  assert.ok(tree.container.textContent.includes(PREVIEW_EMPTY))
  assert.equal(tree.container.querySelector('.dvb-map-file-row.is-on'), null)

  // A fresh request on the same identity still works normally.
  await clickFile(tree, 'main.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  await act(async () => {
    resolveFile(pending, 'src/main.c', 'second-visit-source')
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('second-visit-source')), { timeout: 6000 })
  tree.unmount()
})

test('手动重新加载未完成时切换工作区，旧结果不得写入且不得清除新 busy', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-a')))
  await bootMap(tree, pending)

  const reload = buttonByText(tree, '重新加载')
  assert.ok(reload, 'reload button present')
  await act(async () => {
    reload.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.equal(pending.map.length, 1), { timeout: 6000 })
  const staleReload = pending.map.shift()
  assert.ok(tree.container.textContent.includes('打开中'))

  tree.rerender(createElement(Page, workspaceProps('s1', '/ws-b')))
  await waitForMapPending(pending)
  const fresh = pending.map.shift()

  await act(async () => {
    staleReload.resolve({ ok: true, result: { details: MAP_DETAILS } })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('other.c'), false, 'stale reload must not populate B')
  assert.ok(tree.container.textContent.includes('打开中'), 'stale reload finally must not clear busy for B')

  await act(async () => {
    fresh.resolve({ ok: true, result: { details: MAP_DETAILS_B } })
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('release.c')), { timeout: 6000 })
  assert.equal(tree.container.textContent.includes('other.c'), false)
  assert.equal(tree.container.textContent.includes('打开中'), false)
  tree.unmount()
})

test('文件 1 预览未完成时打开文件 2，文件 1 的响应不得覆盖', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-a')))
  await bootMap(tree, pending)

  await clickFile(tree, 'main.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  const first = pending.file.shift()

  await clickFile(tree, 'other.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  const second = pending.file.shift()
  assert.ok(tree.container.textContent.includes('源码 · src/other.c'))

  await act(async () => {
    second.resolve({ ok: true, rel: 'src/other.c', text: 'other-file-source', lines: 1, truncated: false })
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('other-file-source')), { timeout: 6000 })

  await act(async () => {
    first.resolve({ ok: true, rel: 'src/main.c', text: 'main-file-source', lines: 1, truncated: false })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('main-file-source'), false)
  assert.ok(tree.container.textContent.includes('other-file-source'))
  assert.ok(tree.container.textContent.includes('源码 · src/other.c'))
  tree.unmount()
})

test('卸载后响应返回不得触发状态更新', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-a')))
  await bootMap(tree, pending)

  await clickFile(tree, 'main.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  const reload = buttonByText(tree, '重新加载')
  await act(async () => {
    reload.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.equal(pending.map.length, 1), { timeout: 6000 })
  const lateFile = pending.file.shift()
  const lateMap = pending.map.shift()

  const errors = []
  const origError = console.error
  console.error = (...args) => errors.push(args.map(String).join(' '))
  try {
    tree.unmount()
    await act(async () => {
      lateFile.resolve({ ok: true, rel: 'src/main.c', text: 'after-unmount', lines: 1, truncated: false })
      lateMap.resolve({ ok: true, result: { details: MAP_DETAILS_B } })
      await new Promise((r) => setTimeout(r, 30))
    })
  } finally {
    console.error = origError
  }
  assert.deepEqual(errors, [])
  assert.equal(tree.container.textContent, '')
})

test('相同 cwd 切换 Session 时预览、搜索与在途请求全部隔离', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('sA', '/shared')))
  await bootMap(tree, pending)

  await clickFile(tree, 'main.c')
  await waitFor(() => assert.equal(pending.file.length, 1), { timeout: 6000 })
  const staleFile = pending.file.shift()
  const filterSel = tree.container.querySelector('.dvb-map-filter')
  await act(async () => {
    filterSel.value = 'unread'
    filterSel.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await waitFor(() => assert.equal(tree.container.querySelector('.dvb-map-filter').value, 'unread'), {
    timeout: 6000,
  })
  const reload = buttonByText(tree, '重新加载')
  await act(async () => {
    reload.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.equal(pending.map.length, 1), { timeout: 6000 })
  const staleMap = pending.map.shift()

  tree.rerender(createElement(Page, workspaceProps('sB', '/shared')))
  await waitForMapPending(pending)
  const freshMap = pending.map.shift()
  assert.equal(tree.container.querySelector('.dvb-map-filter').value, 'all', 'filter reset for the new session')
  assert.equal(tree.container.querySelector('.dvb-map-search').value, '')
  assert.ok(tree.container.textContent.includes(PREVIEW_EMPTY))
  assert.equal(tree.container.querySelector('.dvb-map-file-row.is-on'), null)

  await act(async () => {
    staleFile.resolve({ ok: true, rel: 'src/main.c', text: 'session-a-source', lines: 1, truncated: false })
    staleMap.resolve({ ok: true, result: { details: MAP_DETAILS } })
    await new Promise((r) => setTimeout(r, 30))
  })
  assert.equal(tree.container.textContent.includes('session-a-source'), false)
  assert.equal(tree.container.textContent.includes('other.c'), false)
  assert.ok(tree.container.textContent.includes('打开中'), 'session A map finally must not clear session B busy')

  await act(async () => {
    freshMap.resolve({ ok: true, result: { details: MAP_DETAILS_B } })
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('release.c')), { timeout: 6000 })
  assert.equal(tree.container.textContent.includes('other.c'), false)
  assert.ok(tree.container.textContent.includes(PREVIEW_EMPTY))
  tree.unmount()
})

// ---------------------------------------------------------------------------
// Phase 4 — graph truncation metadata reaches real page text
// ---------------------------------------------------------------------------

async function switchToGraph(tree) {
  const btn = buttonByText(tree, '图谱')
  assert.ok(btn, 'graph toggle present')
  await act(async () => {
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-graph-toolbar')), { timeout: 6000 })
}

function graphHints(tree) {
  return Array.from(tree.container.querySelectorAll('.dvb-graph-toolbar .dvb-hint.dvb-need')).map((n) => n.textContent)
}

test('图谱视图显示后端截断、边上限与未解析依赖提示', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-graph')))
  const edges = [
    ...Array.from({ length: 125 }, () => ({ from: 'main.c', to: 'other.c', resolved: true })),
    { from: 'main.c', to: 'nowhere.h', resolved: false },
  ]
  await bootMap(tree, pending, {
    ...MAP_DETAILS,
    include_edges: edges,
    truncated: { include_edges: true },
  })
  await switchToGraph(tree)

  const hints = graphHints(tree)
  assert.deepEqual(hints, ['仅展示前 120 条依赖（另有 6 条未绘制）', '后端已截断依赖列表，当前视图可能不完整'])
  assert.ok(tree.container.textContent.includes('120 依赖'), 'chip reflects rendered edge count')
  assert.ok(tree.container.textContent.includes('已截断'), 'page-level truncated banner from backend flag')
  tree.unmount()
})

test('图谱视图对未解析与被筛选依赖分别提示', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-graph2')))
  const missingFile = {
    name: 'missing.c',
    rel: 'src/missing.c',
    inside: true,
    exists: false,
    readable: false,
    functions: [],
  }
  await bootMap(tree, pending, {
    ...MAP_DETAILS,
    groups: [{ ...MAP_DETAILS.groups[0], files: [...MAP_DETAILS.groups[0].files, missingFile] }],
    include_edges: [
      { from: 'main.c', to: 'other.c', resolved: true },
      { from: 'main.c', to: 'nowhere.h', resolved: false },
    ],
  })
  await switchToGraph(tree)
  assert.deepEqual(graphHints(tree), ['1 条依赖未解析到工程文件'])

  // Filtering to "missing" hides main.c/other.c, so the resolved edge between them is filtered out.
  // (Text-input change events do not reach React under happy-dom, so drive the <select> filter.)
  const sel = tree.container.querySelector('.dvb-map-filter')
  await act(async () => {
    sel.value = 'missing'
    sel.dispatchEvent(new win.Event('change', { bubbles: true }))
  })
  await waitFor(() => assert.equal(tree.container.querySelectorAll('.dvb-graph-node').length, 1), {
    timeout: 6000,
  })
  assert.deepEqual(graphHints(tree), ['1 条依赖未解析到工程文件', '1 条依赖被当前筛选隐藏'])
  tree.unmount()
})

test('干净图谱不显示任何截断提示', async () => {
  const { post, pending } = makeDeferredPost()
  const Page = createProjectWorkspace(React, t, post)
  const tree = render(createElement(Page, workspaceProps('s1', '/ws-graph3')))
  await bootMap(tree, pending, {
    ...MAP_DETAILS,
    include_edges: [{ from: 'main.c', to: 'other.c', resolved: true }],
    truncated: {},
  })
  await switchToGraph(tree)
  assert.deepEqual(graphHints(tree), [])
  assert.equal(tree.container.textContent.includes('已截断'), false)
  assert.ok(tree.container.textContent.includes('1 依赖'))
  tree.unmount()
})
