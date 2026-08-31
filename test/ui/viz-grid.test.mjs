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
    emit(items) {
      if (handler) handler({}, items)
    },
  }
  const GridStack = {
    init() {
      calls.push(['init'])
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

test('removing a component uses removeWidget(el, false)', () => {
  const { calls } = installFake()
  const Grid = createVizGrid(React)
  const item = createElement('div', { className: 'grid-stack-item', 'gs-id': 'a' })
  const tree = render(createElement(Grid, { columns: 12, items: [{ id: 'a', x: 0, y: 0, w: 3, h: 3 }] }, item))
  tree.rerender(createElement(Grid, { columns: 12, items: [] }))
  assert.ok(calls.some((row) => row[0] === 'removeWidget' && row[1] === 'a' && row[2] === false))
  tree.unmount()
})
