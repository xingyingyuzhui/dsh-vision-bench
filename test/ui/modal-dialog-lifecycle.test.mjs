// P2-3: ModalDialog lifecycle (Escape, focus enter/restore, aria title id).
//
// Requires a real document; opts into the page runtime. Structure-only
// coverage stays in `modal-dialog.test.mjs` (react-unit, no HappyDOM).
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { fireEvent, render } from '@testing-library/react'
import React from 'react'
import { createModalDialog } from '../../src/ui/components/modal-dialog.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

const t = (k) => k
const ModalDialog = createModalDialog(React, t)

useReactPageRuntime()

function open(props = {}) {
  const { container, rerender, unmount } = render(
    React.createElement(ModalDialog, { open: true, title: '标题', message: '正文', ...props }),
  )
  return {
    container,
    mask: () => container.querySelector('.dvb-mask'),
    confirm: () => container.querySelector('.dvb-dialog-btn-primary, .dvb-dialog-btn-danger'),
    rerender,
    unmount,
  }
}

test('Escape closes the dialog exactly once', () => {
  const closed = []
  const view = open({ onClose: () => closed.push(true) })
  // Dispatch from inside the dialog so the event follows a realistic bubbling
  // path (element -> ... -> document) instead of targeting the Document node.
  fireEvent.keyDown(view.mask(), { key: 'Escape' })
  assert.equal(closed.length, 1)
})

test('Escape is not observed once the dialog is closed', () => {
  const closed = []
  const onClose = () => closed.push(true)
  const view = open({ onClose })
  view.rerender(React.createElement(ModalDialog, { open: false, title: '标题', onClose }))
  fireEvent.keyDown(document.body, { key: 'Escape' })
  assert.equal(closed.length, 0)
})

test('initial focus goes to the confirm button, and focus returns on close', () => {
  const outside = document.createElement('button')
  outside.textContent = 'outside'
  document.body.appendChild(outside)
  outside.focus()

  const view = open()
  assert.equal(document.activeElement, view.confirm(), 'confirm button receives initial focus')

  view.unmount()
  assert.equal(document.activeElement, outside, 'focus returns to the opener')
  outside.remove()
})

test('an explicit initialFocusRef wins over the confirm button', () => {
  const ref = React.createRef()
  open({
    showCancel: true,
    initialFocusRef: ref,
    content: React.createElement('input', { ref, 'data-testid': 'field' }),
  })
  assert.equal(document.activeElement, ref.current, 'caller-provided ref receives focus')
})

function keyTab(node, shiftKey = false) {
  node.dispatchEvent(new window.KeyboardEvent('keydown', { key: 'Tab', bubbles: true, cancelable: true, shiftKey }))
}

test('danger dialog focuses Cancel, and Tab loops inside the dialog', () => {
  const view = open({ danger: true, kind: 'confirm', showCancel: true, onClose() {} })
  const cancel = view.container.querySelector('.dvb-dialog-btn-cancel')
  const confirm = view.confirm()
  const close = view.container.querySelector('.dvb-dialog-close')
  assert.equal(document.activeElement, cancel, 'cancel receives initial focus')

  confirm.focus()
  keyTab(confirm)
  assert.equal(document.activeElement, close, 'Tab from the last control wraps to the first')

  keyTab(close, true)
  assert.equal(document.activeElement, confirm, 'Shift+Tab from the first control wraps to the last')

  cancel.focus()
  keyTab(cancel)
  assert.equal(document.activeElement, cancel, 'Tab in the middle does not steal focus')
})

test('aria-labelledby points at the rendered title id', () => {
  const view = open()
  const mask = view.mask()
  const titleId = mask.getAttribute('aria-labelledby')
  assert.ok(titleId, 'dialog has an accessible name source')
  assert.equal(mask.querySelector('.dvb-dialog-title').id, titleId)
})
