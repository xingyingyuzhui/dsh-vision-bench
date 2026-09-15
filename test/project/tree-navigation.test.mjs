import assert from 'node:assert/strict'
import { afterEach, test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createMapView } from '../../bench-map.mjs'
import { createDebugWorkspace } from '../../src/ui/workspace/debug-workspace.mjs'
import { clearNavStore, navigate } from '../../src/ui/workspace/vision-navigation-store.mjs'
import { DEBUG_SECTIONS, VIEW_DEBUG } from '../../src/ui/workspace/vision-route.mjs'
import { MAP_DETAILS, makePost } from '../helpers/project-tree-fixtures.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })
afterEach(() => {
  clearNavStore()
})

test('点击编译错误后切到工程结构、展开文件、调用源码接口并传入 jumpLine', async () => {
  const { post, calls } = makePost()
  const t = (k) => k
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'src/main.c', line: 12 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, t, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => {
    const fileCall = calls.find((row) => /\/project\/file$/.test(row[0]))
    assert.ok(fileCall, '源码接口被调用')
    assert.equal(fileCall[1].path, 'src/main.c')
  })
  await waitFor(() => {
    const host = tree.container.querySelector('[data-jump-line]')
    assert.ok(host, '编辑器收到 jumpLine')
    assert.equal(host.getAttribute('data-jump-line'), '12')
  })
  const row = tree.container.querySelector('[data-treeid="src/main.c"]')
  assert.ok(row, '目标文件行存在')
  assert.ok(row.className.includes('is-on') || row.querySelector('.dvb-map-jump'), '目标文件展开并高亮')
  assert.ok(tree.container.textContent.includes('line 12'))
  assert.equal(
    calls.some((row) => row[0] === '/dsh-vision-bench/workspace'),
    false,
    '不再写入 /workspace jumpProject',
  )
  tree.unmount()
})

test('工程树晚于导航目标返回时仍完成定位', async () => {
  let release
  const gate = new Promise((resolve) => {
    release = resolve
  })
  const calls = []
  const post = async (path, body) => {
    calls.push([path, body || {}])
    if (/\/dsh-vision-bench\/state$/.test(path)) {
      return { ok: true, workspace: { keil: { project: '/proj/x.uvprojx', target: 'Debug' } } }
    }
    if (/\/dsh-vision-bench\/keil\/map$/.test(path)) {
      await gate
      return { ok: true, result: { details: MAP_DETAILS } }
    }
    if (/\/dsh-vision-bench\/project\/file$/.test(path)) {
      return { ok: true, rel: body.path, text: 'int main(void) { return 0; }\n', lines: 1, truncated: false }
    }
    return { ok: true }
  }
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'src/main.c', line: 12 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, (k) => k, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await act(async () => {
    await new Promise((r) => setTimeout(r, 40))
  })
  assert.equal(
    calls.some((row) => /\/project\/file$/.test(row[0])),
    false,
    'Map 到达前不得打开源码',
  )
  await act(async () => {
    release()
  })
  await waitFor(() => {
    const fileCall = calls.find((row) => /\/project\/file$/.test(row[0]))
    assert.ok(fileCall)
    assert.equal(fileCall[1].path, 'src/main.c')
  })
  tree.unmount()
})

test('目标不存在时显示错误且不打开源码', async () => {
  const { post, calls } = makePost()
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'ghost.c', line: 9 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, (k) => k, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('未找到文件：ghost.c')))
  assert.equal(
    calls.some((row) => /\/project\/file$/.test(row[0])),
    false,
    '找不到文件时不得请求源码',
  )
  tree.unmount()
})

test('工作区外文件不得尝试打开', async () => {
  const { post, calls } = makePost()
  navigate(
    's1',
    '/ws',
    { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'drv/uart.c', line: 4 } },
    { source: 'manual' },
  )
  const Map = createMapView(React, (k) => k, post)
  const tree = render(createElement(Map, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('工作区外文件不能打开')))
  assert.equal(
    calls.some((row) => /\/project\/file$/.test(row[0])),
    false,
  )
  tree.unmount()
})

test('openProject 带着文件目标后调试工作台切到工程结构', async () => {
  const { post } = makePost()
  const Page = createDebugWorkspace(React, (k) => k, post)
  const tree = render(createElement(Page, { sessionId: 's1', scope: { cwd: '/ws' } }))
  await waitFor(() => {
    const root = tree.container.querySelector('[data-workspace="debug"]')
    assert.ok(root)
    assert.equal(root.getAttribute('data-section'), DEBUG_SECTIONS.WORKBENCH)
  })
  await act(async () => {
    navigate(
      's1',
      '/ws',
      { viewId: VIEW_DEBUG, section: DEBUG_SECTIONS.PROJECT, target: { file: 'src/main.c', line: 12 } },
      { source: 'manual' },
    )
  })
  await waitFor(() => {
    const root = tree.container.querySelector('[data-workspace="debug"]')
    assert.equal(root.getAttribute('data-section'), DEBUG_SECTIONS.PROJECT)
  })
  tree.unmount()
})
