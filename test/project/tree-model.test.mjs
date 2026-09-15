import assert from 'node:assert/strict'
import { test } from 'node:test'
import { render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createMapView } from '../../bench-map.mjs'
import { findProjectFile, jumpErrorForHit } from '../../src/ui/debug/project/project-tree-model.mjs'
import { shouldIgnoreProjectSearchShortcut } from '../../src/ui/debug/project/project-workspace.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { MAP_DETAILS, makePost } from '../helpers/project-tree-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('/ 快捷键在输入控件与对话框内不抢占焦点', async () => {
  const { post } = makePost()
  const t = (k) => ({ projectMap: '工程结构', opening: '打开中' })[k] || k
  const Map = createMapView(React, t, post)
  const tree = render(
    createElement(Map, { ...alpha3PageProps({ sessionId: 's1', path: '/ws' }), scope: { cwd: '/ws' } }),
  )
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-map-search')), { timeout: 6000 })
  const search = tree.container.querySelector('.dvb-map-search')
  const button = tree.container.querySelector('.dvb-project-view-toggle button')
  const dialog = win.document.createElement('div')
  dialog.setAttribute('role', 'dialog')
  const dialogInput = win.document.createElement('input')
  dialog.appendChild(dialogInput)
  win.document.body.appendChild(dialog)

  assert.equal(shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: search }), true, 'input')
  assert.equal(shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: button }), true, 'button')
  assert.equal(
    shouldIgnoreProjectSearchShortcut({
      key: '/',
      defaultPrevented: false,
      target: { tagName: 'DIV', isContentEditable: true, getAttribute: () => null, closest: () => null },
    }),
    true,
    'contenteditable',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({
      key: '/',
      defaultPrevented: false,
      target: Object.assign(win.document.createElement('div'), {
        getAttribute: () => 'textbox',
        closest: () => null,
      }),
    }),
    true,
    'role=textbox',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: dialogInput }),
    true,
    'dialog descendant',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({
      key: '/',
      defaultPrevented: true,
      target: tree.container,
    }),
    true,
    'defaultPrevented',
  )
  assert.equal(
    shouldIgnoreProjectSearchShortcut({ key: '/', defaultPrevented: false, target: tree.container }),
    false,
    'plain container allows shortcut',
  )
  dialog.remove()
  tree.unmount()
})

test('findProjectFile matches rel/suffix and reports outside/missing', () => {
  const hit = findProjectFile(MAP_DETAILS.groups, 'src/main.c')
  assert.equal(hit.file.name, 'main.c')
  assert.equal(hit.kind, 'ok')
  assert.equal(jumpErrorForHit(hit, 'src/main.c'), '')
  assert.equal(findProjectFile(MAP_DETAILS.groups, 'nope.c'), null)
  assert.equal(jumpErrorForHit(null, 'nope.c'), '未找到文件：nope.c')
  const outside = findProjectFile(MAP_DETAILS.groups, 'drv/uart.c')
  assert.equal(jumpErrorForHit(outside, 'drv/uart.c'), '工作区外文件不能打开')
  const missing = findProjectFile(MAP_DETAILS.groups, 'src/missing.c')
  assert.equal(jumpErrorForHit(missing, 'src/missing.c'), '文件缺失，无法打开')
})
