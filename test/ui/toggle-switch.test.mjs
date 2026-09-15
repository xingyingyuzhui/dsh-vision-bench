// P2-1: ToggleSwitch direct behaviour tests (ADR-025 D5/D6/D9).
//
// Lives on the page runtime rather than the unit harness on purpose: the
// duplicate-change risk this file exists to pin down comes from *native*
// button activation (Enter/Space synthesise a click), which only a real DOM
// can express. happy-dom does not synthesise that click, so these tests assert
// the structural contract instead: exactly one activation path must be wired.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fireEvent, render } from '@testing-library/react'
import React from 'react'
import { createToggleSwitch, renderToggleSwitch } from '../../src/ui/components/toggle-switch.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime()

const Toggle = createToggleSwitch(React)

function renderToggle(props = {}) {
  return render(React.createElement(Toggle, { ariaLabel: '示例开关', ...props }))
}

test('renders a switch button with the shared classes and checked state', () => {
  const { container } = renderToggle({ checked: true })
  const button = container.querySelector('button')
  assert.equal(button.getAttribute('role'), 'switch')
  assert.equal(button.getAttribute('aria-checked'), 'true')
  assert.equal(button.getAttribute('data-checked'), 'true')
  assert.ok(button.className.includes('dvb-setting-switch'))
  assert.ok(button.querySelector('.dvb-setting-switch-thumb'))
})

test('click activates exactly one change with the negated value', () => {
  const calls = []
  const { container } = renderToggle({ checked: false, onChange: (next) => calls.push(next) })
  fireEvent.click(container.querySelector('button'))
  assert.deepEqual(calls, [true])
})

test('a native keyboard activation is a single change', () => {
  // happy-dom does not synthesise the click a browser produces for Enter/Space
  // on a real button, so the browser's activation is modelled as keydown + the
  // click it generates. The component must not add its own keydown path on top.
  const calls = []
  const { container } = renderToggle({ checked: false, onChange: (next) => calls.push(next) })
  const button = container.querySelector('button')

  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.click(button)
  assert.deepEqual(calls, [true], `Enter must activate once, got ${calls.length}`)

  calls.length = 0
  fireEvent.keyDown(button, { key: ' ' })
  fireEvent.click(button)
  assert.deepEqual(calls, [true], `Space must activate once, got ${calls.length}`)
})

test('keydown alone does not activate, so a synthesised click cannot double-fire', () => {
  const calls = []
  const { container } = renderToggle({ checked: false, onChange: (next) => calls.push(next) })
  const button = container.querySelector('button')
  fireEvent.keyDown(button, { key: 'Enter' })
  fireEvent.keyDown(button, { key: ' ' })
  assert.deepEqual(calls, [], 'activation is owned by the native click path only')
})

test('disabled toggle renders switch semantics but never fires', () => {
  const calls = []
  const { container } = renderToggle({ checked: true, disabled: true, onChange: (next) => calls.push(next) })
  const button = container.querySelector('button')
  assert.equal(button.disabled, true)
  assert.equal(button.getAttribute('aria-checked'), 'true')
  fireEvent.click(button)
  fireEvent.keyDown(button, { key: ' ' })
  fireEvent.keyDown(button, { key: 'Enter' })
  assert.deepEqual(calls, [])
})

test('controlled value change re-renders aria-checked', () => {
  const { container, rerender } = renderToggle({ checked: false })
  assert.equal(container.querySelector('button').getAttribute('aria-checked'), 'false')
  rerender(React.createElement(Toggle, { checked: true, ariaLabel: '示例开关' }))
  assert.equal(container.querySelector('button').getAttribute('aria-checked'), 'true')
})

test('exposes the caller accessible name and title', () => {
  const { container } = renderToggle({ ariaLabel: '共享 connections', title: '共享' })
  const button = container.querySelector('button')
  assert.equal(button.getAttribute('aria-label'), '共享 connections')
  assert.equal(button.getAttribute('title'), '共享')
})

test('append className without dropping the component class', () => {
  const { container } = renderToggle({ className: 'is-compact' })
  const button = container.querySelector('button')
  assert.ok(button.className.includes('dvb-setting-switch'))
  assert.ok(button.className.includes('is-compact'))
})

test('caller id wins over any generated id', () => {
  const { container } = renderToggle({ id: 'share-master' })
  assert.equal(container.querySelector('button').id, 'share-master')
})

test('renderToggleSwitch is the hook-free structural form used by raw DOM callers', () => {
  const el = (type, props, ...children) => ({ type, props: props || {}, children })
  const node = renderToggleSwitch(el, { checked: true, ariaLabel: '原始' })
  assert.equal(node.type, 'button')
  assert.equal(node.props.role, 'switch')
  assert.equal(node.props['aria-checked'], 'true')
  assert.equal(node.props['aria-label'], '原始')
})
