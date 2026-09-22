import assert from 'node:assert/strict'
import test from 'node:test'
import { renderFilterItem, renderFilterToolbar } from '../../src/ui/patterns/filter-toolbar.mjs'

const el = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat().filter((c) => c != null && c !== false),
})

test('renderFilterToolbar composes filters, search and reset', () => {
  const filter = renderFilterItem(el, { label: '来源', control: el('select', { className: 'x' }) })
  let search = ''
  let reset = 0
  const node = renderFilterToolbar(el, {
    className: 'dvb-journal-toolbar',
    filters: [filter],
    search: 'q',
    searchPlaceholder: '搜索',
    onSearchChange: (v) => {
      search = v
    },
    onReset: () => {
      reset += 1
    },
  })
  assert.ok(node.props.className.includes('dvb-filter-toolbar'))
  assert.ok(node.props.className.includes('dvb-journal-toolbar'))
  const searchBox = node.children.find((c) => c.props?.className === 'dvb-search-box')
  const input = searchBox.children.find((c) => c.type === 'input')
  input.props.onChange({ target: { value: 'abc' } })
  assert.equal(search, 'abc')
  const resetBtn = node.children.find((c) => c.props?.className?.includes('dvb-btn-reset'))
  resetBtn.props.onClick()
  assert.equal(reset, 1)
})
