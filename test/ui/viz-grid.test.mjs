import assert from 'node:assert/strict'
import { afterEach, beforeEach, test } from 'node:test'
import { act, cleanup, render } from '@testing-library/react'
import { Window } from 'happy-dom'
import React from 'react'
import { createElement } from 'react'
import { createVizGrid } from '../../src/ui/components/viz-grid.mjs'
import { setGridRuntime } from '../../src/ui/vendor/grid-runtime.mjs'

let win
beforeEach(() => {
  win = new Window({ url: 'http://localhost/' })
  globalThis.window = win
  globalThis.document = win.document
  globalThis.HTMLElement = win.HTMLElement
  globalThis.Element = win.HTMLElement
})
afterEach(() => {
  cleanup()
  setGridRuntime(null)
})

function installFake() {
  const calls = []
  let handler = null
  const nodes = []
  const grid = {
    engine: { nodes },
    opts: {},
    on(name, fn) {
      calls.push(['on', name])
      handler = fn
    },
    off(name) {
      calls.push(['off', name])
      handler = null
    },
    destroy(keep) {
      calls.push(['destroy', keep])
    },
    makeWidget(el) {
      el.gridstackNode = { el, id: el.getAttribute('gs-id') }
      nodes.push(el.gridstackNode)
      calls.push(['makeWidget', el.getAttribute('gs-id')])
    },
    update(el, box) {
      calls.push(['update', el.getAttribute('gs-id'), box])
    },
    removeWidget(el, removeDom) {
      calls.push(['removeWidget', el.getAttribute('gs-id'), removeDom])
    },
    batchUpdate() {
      calls.push(['batchUpdate'])
    },
    commit() {
      calls.push(['commit'])
    },
    setStatic(val) {
      calls.push(['setStatic', val])
    },
    enableMove(val) {
      calls.push(['enableMove', val])
    },
    enableResize(val) {
      calls.push(['enableResize', val])
    },
    _updateContainerHeight() {
      calls.push(['_updateContainerHeight'])
    },
    emit(items) {
      if (handler) handler({}, items)
    },
  }
  const GridStack = {
    init(opts) {
      calls.push(['init', opts])
      grid.lastOpts = opts
      grid.opts = { ...opts }
      return grid
    },
  }
  setGridRuntime(GridStack)
  return { calls, grid }
}

test('initial items call makeWidget; external coord change uses grid.update', () => {
  const { calls } = installFake()
  const Grid = createVizGrid(React)
  const tree = render(
    createElement(
      Grid,
      { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.ok(calls.some((row) => row[0] === 'makeWidget' && row[1] === 'a'))
  tree.rerender(
    createElement(
      Grid,
      { columns: 12, items: [{ id: 'a', x: 2, y: 1, w: 4, h: 3 }], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.ok(calls.some((row) => row[0] === 'update' && row[1] === 'a' && row[2].x === 2 && row[2].y === 1))
  tree.unmount()
})

test('external sync does not echo onLayout; drag does submit layout', () => {
  const { calls, grid } = installFake()
  const layouts = []
  const Grid = createVizGrid(React)
  const tree = render(
    createElement(
      Grid,
      {
        columns: 12,
        items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }],
        onLayout(items) {
          layouts.push(items)
        },
      },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.equal(layouts.length, 0, 'sync must not save')
  grid.emit([{ id: 'a', x: 1, y: 0, w: 3, h: 3, el: tree.container.querySelector('.grid-stack-item') }])
  assert.equal(layouts.length, 1)
  assert.equal(layouts[0][0].x, 1)
  tree.unmount()
  assert.ok(calls.some((row) => row[0] === 'off'))
  assert.ok(calls.some((row) => row[0] === 'destroy' && row[1] === false))
})

test('readOnly=true initializes GridStack as static', () => {
  const { calls, grid } = installFake()
  const Grid = createVizGrid(React)
  const tree = render(
    createElement(
      Grid,
      { columns: 12, readOnly: true, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  const init = calls.find((row) => row[0] === 'init')
  assert.equal(init[1].staticGrid, true)
  assert.equal(init[1].disableDrag, true)
  assert.equal(init[1].disableResize, true)
  assert.equal(grid.lastOpts.staticGrid, true)
  assert.equal(tree.container.querySelector('.dvb-viz-grid').getAttribute('data-readonly'), 'true')
  tree.unmount()
})

test('readOnly GridStack ignores change events', () => {
  const { grid } = installFake()
  const layouts = []
  const Grid = createVizGrid(React)
  const tree = render(
    createElement(
      Grid,
      {
        columns: 12,
        readOnly: true,
        items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }],
        onLayout(items) {
          layouts.push(items)
        },
      },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  grid.emit([{ id: 'a', x: 4, y: 0, w: 3, h: 3, el: tree.container.querySelector('.grid-stack-item') }])
  assert.equal(layouts.length, 0)
  tree.unmount()
})

test('removing a component uses removeWidget(el, false)', () => {
  const { calls } = installFake()
  const Grid = createVizGrid(React)
  const item = createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' })
  const tree = render(createElement(Grid, { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }] }, item))
  tree.rerender(createElement(Grid, { columns: 12, items: [] }))
  assert.ok(calls.some((row) => row[0] === 'removeWidget' && row[1] === 'a' && row[2] === false))
  tree.unmount()
})

test('editing=false initializes staticGrid and data-editing="false"', () => {
  const { calls } = installFake()
  const Grid = createVizGrid(React)
  const tree = render(
    createElement(
      Grid,
      { columns: 12, editing: false, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  const init = calls.find((row) => row[0] === 'init')
  assert.equal(init[1].staticGrid, true)
  assert.equal(init[1].disableDrag, true)
  assert.equal(init[1].disableResize, true)
  assert.equal(tree.container.querySelector('.dvb-viz-grid').getAttribute('data-editing'), 'false')
  assert.ok(init[1].handle.includes('.dvb-viz-head-main'))
  tree.unmount()
})

test('editing=true dynamically unlocks GridStack via setStatic', () => {
  const { calls } = installFake()
  const Grid = createVizGrid(React)
  const tree = render(
    createElement(
      Grid,
      { columns: 12, editing: false, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.equal(tree.container.querySelector('.dvb-viz-grid').getAttribute('data-editing'), 'false')

  tree.rerender(
    createElement(
      Grid,
      { columns: 12, editing: true, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.equal(tree.container.querySelector('.dvb-viz-grid').getAttribute('data-editing'), 'true')
  assert.ok(calls.some((row) => row[0] === 'setStatic' && row[1] === false))
  assert.ok(calls.some((row) => row[0] === 'enableMove' && row[1] === true))
  assert.ok(calls.some((row) => row[0] === 'enableResize' && row[1] === true))
  tree.unmount()
})

test('editing=true expands minRow and editing=false auto-shrinks to components range', () => {
  const { calls, grid } = installFake()
  const Grid = createVizGrid(React)
  const item = { id: 'a', x: 0, y: 0, w: 6, h: 4 }
  const tree = render(
    createElement(
      Grid,
      { columns: 12, editing: false, items: [item], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  const initCall = calls.find((row) => row[0] === 'init')
  assert.equal(initCall[1].minRow, 0, '非编辑模式初始 minRow 为 0（自适应组件高度）')
  assert.equal(initCall[1].float, true, 'float=true 允许自由拖动定位')

  // 切换到编辑模式：画布不限制大小，minRow 扩展
  tree.rerender(
    createElement(
      Grid,
      { columns: 12, editing: true, items: [item], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.ok(grid.opts.minRow >= 16, '编辑状态 minRow 至少为 16，不限制画布大小')
  assert.ok(calls.some((row) => row[0] === '_updateContainerHeight'), '触发容器高度刷新')

  // 退出编辑模式（保存后）：minRow 恢复为 0，自动缩到组件范围
  tree.rerender(
    createElement(
      Grid,
      { columns: 12, editing: false, items: [item], onLayout() {} },
      createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' }),
    ),
  )
  assert.equal(grid.opts.minRow, 0, '保存后恢复锁定，minRow 归零自动缩回到组件布局范围')
  tree.unmount()
})


