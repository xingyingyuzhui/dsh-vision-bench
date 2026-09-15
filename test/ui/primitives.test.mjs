import assert from 'node:assert/strict'
import test from 'node:test'
import { createHint, createPanel, createTabs } from '../../src/ui/components/primitives.mjs'
import { mockReact } from '../helpers/react-unit.mjs'

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
    items: [
      { key: 'bp', label: '断点', count: 2 },
      { key: 'wp', label: '硬件观察点', count: 0 },
    ],
  })
  assert.equal(tabs.props.className, 'dvb-debug-tabs')
  assert.equal(tabs.children[0].props.className, 'dvb-debug-subtab is-active')
  assert.equal(tabs.children[0].children[0], '断点 (2)')
  const hint = Hint({ children: '空' })
  assert.equal(hint.props.className, 'dvb-hint')
})
