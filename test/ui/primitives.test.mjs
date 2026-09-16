import assert from 'node:assert/strict'
import test from 'node:test'
import { createHint, createPanel, createTabs } from '../../src/ui/components/primitives.mjs'
import { key, mockReact } from '../helpers/react-unit.mjs'

const TAB_ITEMS = [
  { key: 'bp', label: '断点', count: 2 },
  { key: 'wp', label: '硬件观察点', count: 0 },
  { key: 'var', label: '变量' },
]

test('Panel/Tabs/Hint emit the shared debug chrome classes', () => {
  const Panel = createPanel(mockReact)
  const Tabs = createTabs(mockReact)
  const Hint = createHint(mockReact)
  const panel = Panel({ className: 'extra', children: 'x' })
  assert.equal(panel.props.className, 'dvb-debug-panel extra')
  const head = Panel.Head({ children: 'h' })
  assert.equal(head.props.className, 'dvb-debug-panel-head')
  const tabs = Tabs({
    value: 'bp',
    items: TAB_ITEMS.slice(0, 2),
  })
  assert.equal(tabs.props.className, 'dvb-debug-tabs')
  assert.equal(tabs.props.role, 'tablist')
  assert.equal(tabs.children[0].props.className, 'dvb-debug-subtab is-active')
  assert.equal(tabs.children[0].props.role, 'tab')
  assert.equal(tabs.children[0].props['aria-selected'], true)
  assert.equal(tabs.children[1].props['aria-selected'], false)
  assert.equal(tabs.children[0].children[0], '断点 (2)')
  const hint = Hint({ children: '空' })
  assert.equal(hint.props.className, 'dvb-hint')
})

test('Tabs keyboard arrows and Home/End call onChange with the next key', () => {
  const Tabs = createTabs(mockReact)
  const changes = []
  const onChange = (next) => changes.push(next)

  const mid = Tabs({ value: 'wp', items: TAB_ITEMS, onChange })
  key(mid, 'ArrowRight')
  key(mid, 'ArrowLeft')
  key(mid, 'Home')
  key(mid, 'End')
  assert.deepEqual(changes, ['var', 'bp', 'bp', 'var'])

  const wrapRight = Tabs({ value: 'var', items: TAB_ITEMS, onChange })
  changes.length = 0
  key(wrapRight, 'ArrowRight')
  assert.deepEqual(changes, ['bp'])

  const wrapLeft = Tabs({ value: 'bp', items: TAB_ITEMS, onChange })
  changes.length = 0
  key(wrapLeft, 'ArrowLeft')
  assert.deepEqual(changes, ['var'])
})

test('Tabs keyboard handlers call preventDefault', () => {
  const Tabs = createTabs(mockReact)
  const tabs = Tabs({ value: 'bp', items: TAB_ITEMS, onChange() {} })
  let prevented = false
  key(tabs, 'ArrowRight', {
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
})
