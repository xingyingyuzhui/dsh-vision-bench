import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { createCustomSelect, getCustomSelect, renderCustomSelect } from '../src/ui/components/custom-select.mjs'

const el = (type, props, ...children) => ({
  type,
  props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  children: children.flat().filter(Boolean),
})

test('renderCustomSelect renders closed trigger with current value label', () => {
  const tree = renderCustomSelect(el, {
    value: 'rtu',
    options: [
      { value: 'rtu', label: 'RTU' },
      { value: 'tcp', label: 'TCP' },
    ],
    open: false,
  })

  assert.ok(tree)
  assert.equal(tree.props.className, 'dvb-select')
  const trigger = tree.children[0]
  assert.equal(trigger.type, 'button')
  assert.ok(trigger.props.className.includes('dvb-select-trigger'))
  assert.equal(trigger.props['aria-expanded'], 'false')

  const labelSpan = trigger.children[0]
  assert.equal(labelSpan.children[0], 'RTU')

  const chevron = trigger.children[1]
  assert.equal(chevron.props.className, 'dvb-select-chevron')

  // No dropdown when closed
  assert.equal(tree.children.length, 1)
})

test('renderCustomSelect renders open dropdown menu with options and checkmark on selected option', () => {
  const calls = []
  const tree = renderCustomSelect(el, {
    value: 'rtu',
    options: [
      { value: 'rtu', label: 'RTU' },
      { value: 'tcp', label: 'TCP' },
    ],
    open: true,
    onChange: (val) => calls.push({ type: 'change', val }),
    onToggle: (open) => calls.push({ type: 'toggle', open }),
  })

  assert.equal(tree.children.length, 2, 'Has trigger and dropdown menu')
  const dropdown = tree.children[1]
  assert.ok(dropdown.props.className.includes('dvb-select-dropdown'))
  assert.equal(dropdown.children.length, 2)

  // 1st option: RTU (selected)
  const opt1 = dropdown.children[0]
  assert.ok(opt1.props.className.includes('is-selected'))
  assert.equal(opt1.props['aria-selected'], 'true')
  assert.equal(opt1.children[0].children[0], 'RTU')
  // Checkmark icon present on selected option
  const checkSvg = opt1.children[1]
  assert.ok(checkSvg)
  assert.equal(checkSvg.props.className, 'dvb-select-check')

  // 2nd option: TCP (not selected)
  const opt2 = dropdown.children[1]
  assert.ok(!opt2.props.className.includes('is-selected'))
  assert.equal(opt2.props['aria-selected'], 'false')
  assert.equal(opt2.children[0].children[0], 'TCP')
  assert.equal(opt2.children[1], undefined, 'No checkmark on unselected option')

  // Clicking TCP triggers onChange and onToggle(false)
  opt2.props.onClick({ preventDefault() {}, stopPropagation() {} })
  assert.deepEqual(calls, [
    { type: 'change', val: 'tcp' },
    { type: 'toggle', open: false },
  ])
})

test('renderCustomSelect handles disabled options correctly', () => {
  const calls = []
  const tree = renderCustomSelect(el, {
    value: 'client',
    options: [
      { value: 'client', label: '主机(master)' },
      { value: 'server', label: '从机(未启用)', disabled: true, title: '从机模式暂未启用' },
    ],
    open: true,
    onChange: (val) => calls.push(val),
  })

  const dropdown = tree.children[1]
  const disabledOpt = dropdown.children[1]
  assert.ok(disabledOpt.props.className.includes('is-disabled'))
  assert.equal(disabledOpt.props['aria-disabled'], 'true')
  assert.equal(disabledOpt.props.title, '从机模式暂未启用')

  disabledOpt.props.onClick({ preventDefault() {}, stopPropagation() {} })
  assert.equal(calls.length, 0, 'Disabled option click is blocked')
})

test('renderCustomSelect normalizes primitive numbers and strings', () => {
  const tree = renderCustomSelect(el, {
    value: 1000,
    options: [200, 500, 1000, 2000],
    open: false,
  })

  const trigger = tree.children[0]
  assert.equal(trigger.children[0].children[0], '1000')
})

test('getCustomSelect returns stable cached component instance across renders', () => {
  const comp1 = getCustomSelect(React)
  const comp2 = getCustomSelect(React)
  assert.equal(comp1, comp2, 'Same React instance returns identical CustomSelect function reference')
})

test('renderCustomSelect ARIA attributes: combobox, listbox, option, aria-controls, aria-activedescendant', () => {
  const tree = renderCustomSelect(el, {
    id: 'my-select',
    value: 'tcp',
    options: [
      { value: 'rtu', label: 'RTU' },
      { value: 'tcp', label: 'TCP' },
      { value: 'udp', label: 'UDP', disabled: true },
    ],
    open: true,
    highlightIndex: 1,
  })

  const trigger = tree.children[0]
  assert.equal(trigger.props.role, 'combobox')
  assert.equal(trigger.props['aria-controls'], 'my-select-listbox')
  assert.equal(trigger.props['aria-activedescendant'], 'my-select-listbox-opt-1')

  const listbox = tree.children[1]
  assert.equal(listbox.props.role, 'listbox')
  assert.equal(listbox.props.id, 'my-select-listbox')

  const opt0 = listbox.children[0]
  assert.equal(opt0.props.role, 'option')
  assert.equal(opt0.props.id, 'my-select-listbox-opt-0')

  const opt1 = listbox.children[1]
  assert.equal(opt1.props.role, 'option')
  assert.equal(opt1.props.id, 'my-select-listbox-opt-1')
  assert.ok(opt1.props.className.includes('is-highlighted'))
})

test('renderCustomSelect keyboard navigation: ArrowDown/Up skips disabled, Enter selects, Escape closes', () => {
  const calls = []
  const highlights = []

  const tree = renderCustomSelect(el, {
    id: 'kbd-select',
    value: 'rtu',
    options: [
      { value: 'rtu', label: 'RTU' },
      { value: 'disabled-opt', label: 'Disabled', disabled: true },
      { value: 'tcp', label: 'TCP' },
    ],
    open: true,
    highlightIndex: 0,
    onChange: (val) => calls.push({ type: 'change', val }),
    onToggle: (open) => calls.push({ type: 'toggle', open }),
    onHighlightIndexChange: (idx) => highlights.push(idx),
  })

  const trigger = tree.children[0]

  // ArrowDown should skip disabled option (index 1) and jump to index 2 (TCP)
  let prevented = false
  trigger.props.onKeyDown({
    key: 'ArrowDown',
    preventDefault() {
      prevented = true
    },
  })
  assert.equal(prevented, true)
  assert.equal(highlights[0], 2, 'ArrowDown skipped disabled option')

  // ArrowUp from index 0 should wrap around backwards to index 2 (skipping disabled index 1)
  highlights.length = 0
  trigger.props.onKeyDown({
    key: 'ArrowUp',
    preventDefault() {},
  })
  assert.equal(highlights[0], 2, 'ArrowUp wrapped to last enabled option')

  // Enter selects the currently highlighted option (0 = RTU)
  trigger.props.onKeyDown({
    key: 'Enter',
    preventDefault() {},
  })
  assert.deepEqual(calls, [
    { type: 'change', val: 'rtu' },
    { type: 'toggle', open: false },
  ])

  // Escape closes dropdown
  calls.length = 0
  trigger.props.onKeyDown({
    key: 'Escape',
    preventDefault() {},
    stopPropagation() {},
  })
  assert.deepEqual(calls, [{ type: 'toggle', open: false }])
})

test('renderCustomSelect renders native select bridge when renderNativeSelect is true', () => {
  const calls = []
  const tree = renderCustomSelect(el, {
    value: 'tcp',
    options: [
      { value: 'rtu', label: 'RTU' },
      { value: 'tcp', label: 'TCP' },
    ],
    open: false,
    renderNativeSelect: true,
    onChange: (val) => calls.push(val),
  })

  // Has trigger and native select
  assert.equal(tree.children.length, 2)
  const nativeSelect = tree.children[1]
  assert.equal(nativeSelect.type, 'select')
  assert.equal(nativeSelect.props.className, 'dvb-select-native')
  assert.equal(nativeSelect.props.value, 'tcp')
  assert.equal(nativeSelect.props['aria-hidden'], 'true')
  assert.equal(nativeSelect.props.tabIndex, -1)
  assert.equal(nativeSelect.children.length, 2)

  // Dispatches change
  nativeSelect.props.onChange({ target: { value: 'rtu' } })
  assert.deepEqual(calls, ['rtu'])
})
