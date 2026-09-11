import assert from 'node:assert/strict'
import { readFileSync } from 'node:fs'
import { dirname, join } from 'node:path'
import test from 'node:test'
import { fileURLToPath } from 'node:url'
import { createTable, getCoreRowModel, getSortedRowModel } from '@tanstack/table-core'
import { createDataTable } from '../../src/ui/components/data-table.mjs'
import { setTableRuntime } from '../../src/ui/vendor/table-runtime.mjs'

const root = join(dirname(fileURLToPath(import.meta.url)), '../..')

function walk(node, visit) {
  if (!node || typeof node !== 'object') return
  visit(node)
  const kids = node.children
  if (Array.isArray(kids)) {
    for (const child of kids) {
      if (Array.isArray(child)) child.forEach((x) => walk(x, visit))
      else walk(child, visit)
    }
  }
}

function rowsOf(tree) {
  const out = []
  walk(tree, (node) => {
    if (node.props && node.props['data-rowid'] != null) out.push(node)
  })
  return out
}

function makeReact() {
  const store = { i: 0, slots: [] }
  const React = {
    createElement(type, props, ...children) {
      if (typeof type === 'function') return type({ ...(props || {}), children })
      return { type, props: props || {}, children }
    },
    useState(init) {
      const i = store.i++
      if (store.slots[i] === undefined) store.slots[i] = typeof init === 'function' ? init() : init
      return [
        store.slots[i],
        (next) => {
          store.slots[i] = typeof next === 'function' ? next(store.slots[i]) : next
        },
      ]
    },
    useRef(init) {
      const i = store.i++
      if (store.slots[i] === undefined) store.slots[i] = { current: init }
      return store.slots[i]
    },
  }
  return {
    React,
    rerender(fn) {
      store.i = 0
      return fn()
    },
  }
}

test('table-core source does not import react-dom or createPortal', () => {
  const src = readFileSync(join(root, 'node_modules/@tanstack/table-core/build/lib/index.mjs'), 'utf8')
  assert.doesNotMatch(src, /react-dom/)
  assert.doesNotMatch(src, /createPortal/)
  assert.doesNotMatch(src, /from\s+['"]react['"]/)
})

test('DataTable requires getRowId and never uses array index as row id', async () => {
  setTableRuntime({ createTable, getCoreRowModel, getSortedRowModel })
  const { React, rerender } = makeReact()
  const DataTable = createDataTable(React)
  assert.throws(() => DataTable({ data: [], columns: [] }), /getRowId/)
  const data = Array.from({ length: 8 }, (_, i) => ({ frameId: `f-${i + 1}`, t: i }))
  const tree = rerender(() =>
    DataTable({
      data,
      columns: [{ id: 't', header: 't', accessorKey: 't' }],
      getRowId: (row) => String(row.frameId),
    }),
  )
  const ids = rowsOf(tree).map((n) => n.props['data-rowid'])
  assert.deepEqual(
    ids,
    data.map((row) => row.frameId),
  )
  assert.ok(ids.every((id) => id && !/^[0-7]$/.test(id)))
  setTableRuntime(null)
})

test('virtualized DataTable does not put 5000 rows in the tree', async () => {
  setTableRuntime({ createTable, getCoreRowModel, getSortedRowModel })
  const { React, rerender } = makeReact()
  const DataTable = createDataTable(React)
  const data = Array.from({ length: 5000 }, (_, i) => ({ frameId: `c1-f${i + 1}`, t: i }))
  const vizer = {
    getVirtualItems: () =>
      Array.from({ length: 12 }, (_, i) => ({ index: i, start: i * 36, size: 36, key: data[i].frameId })),
    getTotalSize: () => 5000 * 36,
  }
  const tree = rerender(() =>
    DataTable({
      data,
      columns: [{ id: 't', header: 't', accessorKey: 't' }],
      getRowId: (row) => String(row.frameId),
      virtualize: true,
      useVirtualizer: () => vizer,
      getRowProps: (row) => ({ className: 'dvb-live-row', 'data-frameid': row.id }),
    }),
  )
  const nodes = rowsOf(tree)
  assert.equal(nodes.length, 12)
  assert.equal(nodes[0].props['data-frameid'], 'c1-f1')
  assert.equal(nodes[0].props['data-rowid'], 'c1-f1')
  setTableRuntime(null)
})

test('fallback without table-core still uses getRowId', () => {
  setTableRuntime(null)
  const { React, rerender } = makeReact()
  const DataTable = createDataTable(React)
  const tree = rerender(() =>
    DataTable({
      data: [
        { id: 'a1', label: 'one' },
        { id: 'a2', label: 'two' },
      ],
      columns: [{ id: 'label', header: 'label', accessorKey: 'label' }],
      getRowId: (row) => String(row.id),
    }),
  )
  assert.deepEqual(
    rowsOf(tree).map((n) => n.props['data-rowid']),
    ['a1', 'a2'],
  )
})

test('DataTable renders resizers and handles when onStartResize is provided', () => {
  const { React, rerender } = makeReact()
  const DataTable = createDataTable(React)
  let resizedCol = null
  let resetCol = null

  const tree = rerender(() =>
    DataTable({
      data: [{ id: '1', colA: 'A', colB: 'B' }],
      columns: [
        { id: 'colA', header: 'Col A', accessorKey: 'colA' },
        { id: 'colB', header: 'Col B', accessorKey: 'colB', enableResizing: false },
      ],
      getRowId: (row) => String(row.id),
      totalWidth: 500,
      onStartResize: (key) => { resizedCol = key },
      resetColWidth: (key) => { resetCol = key },
    }),
  )

  const resizers = []
  walk(tree, (n) => {
    if (n.props && n.props.className === 'dvb-col-resizer') resizers.push(n)
  })

  assert.equal(resizers.length, 1)
  assert.equal(resizers[0].props['data-col'], 'colA')

  resizers[0].props.onPointerDown({ clientX: 100, preventDefault() {}, stopPropagation() {} })
  assert.equal(resizedCol, 'colA')

  resizers[0].props.onDoubleClick()
  assert.equal(resetCol, 'colA')

  // Check minWidth on head and row
  let headNode = null
  walk(tree, (n) => {
    if (n.props && n.props.className === 'dvb-data-table-head') headNode = n
  })
  assert.ok(headNode)
  assert.equal(headNode.props.style.minWidth, '500px')
})

