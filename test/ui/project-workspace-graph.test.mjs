import assert from 'node:assert/strict'
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createProjectWorkspace } from '../../src/ui/debug/project/project-workspace.mjs'
import {
  MAP_DETAILS,
  bootMap,
  graphHints,
  makeDeferredPost,
  resolveMap,
  switchToGraph,
  t,
  win,
  workspaceProps,
} from '../helpers/project-workspace-fixtures.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

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
