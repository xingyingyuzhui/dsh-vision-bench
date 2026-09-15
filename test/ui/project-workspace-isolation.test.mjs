import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, fireEvent, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createProjectWorkspace } from '../../src/ui/debug/project/project-workspace.mjs'
import {
  MAP_DETAILS,
  MAP_DETAILS_B,
  PREVIEW_EMPTY,
  bootMap,
  buttonByText,
  clickFile,
  makeDeferredPost,
  resolveFile,
  resolveMap,
  t,
  waitForMapPending,
  win,
  workspaceProps,
} from '../helpers/project-workspace-fixtures.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

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
