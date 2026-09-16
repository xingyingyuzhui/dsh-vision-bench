// P2-1: ModalDialog pure structure (ADR-025 D2).
//
// No HappyDOM / page runtime — structure and callbacks are asserted through
// the DOM-free `react-unit` harness.
import assert from 'node:assert/strict'
import { test } from 'node:test'
import { renderModalDialog } from '../../src/ui/components/modal-dialog.mjs'
import { click, el } from '../helpers/react-unit.mjs'

const t = (k) => k

test('renderModalDialog returns null when closed or without props', () => {
  assert.equal(renderModalDialog(el, t, null), null)
  assert.equal(renderModalDialog(el, t, { open: false }), null)
})

test('structure: role, aria-modal, labelled title and shared classes', () => {
  const node = renderModalDialog(el, t, { open: true, title: '连接失败', titleId: 'dlg-title' })
  assert.equal(node.props.role, 'dialog')
  assert.equal(node.props['aria-modal'], 'true')
  assert.equal(node.props['aria-labelledby'], 'dlg-title')
  const title = node.children[0].children[0].children[0].children[1]
  assert.equal(title.props.className, 'dvb-dialog-title')
  assert.equal(title.props.id, 'dlg-title')
  assert.equal(title.children[0], '连接失败')
})

test('structure: danger confirm and cancel buttons keep their contracts', () => {
  const canceled = []
  const confirmed = []
  const node = renderModalDialog(el, t, {
    open: true,
    kind: 'confirm',
    danger: true,
    showCancel: true,
    onCancel: () => canceled.push(true),
    onConfirm: () => confirmed.push(true),
  })
  const footer = node.children[0].children[2]
  const cancel = footer.children[0]
  const confirm = footer.children[1]
  assert.ok(cancel.props.className.includes('dvb-dialog-btn-cancel'))
  assert.ok(confirm.props.className.includes('dvb-dialog-btn-danger'))
  click(cancel)
  click(confirm)
  assert.equal(canceled.length, 1)
  assert.equal(confirmed.length, 1)
})

test('structure: loading disables both actions and marks aria-busy', () => {
  const node = renderModalDialog(el, t, { open: true, showCancel: true, loading: true })
  assert.equal(node.props['aria-busy'], 'true')
  const footer = node.children[0].children[2]
  assert.equal(footer.children[0].props.disabled, true)
  assert.equal(footer.children[1].props.disabled, true)
})

test('mask click closes, inner click does not', () => {
  const closed = []
  const node = renderModalDialog(el, t, { open: true, onClose: () => closed.push(true) })
  node.children[0].props.onClick({ stopPropagation() {} })
  assert.equal(closed.length, 0, 'inner click is stopped')
  node.props.onClick()
  assert.equal(closed.length, 1)
})

test('maskClosable=false keeps the mask inert', () => {
  const closed = []
  const node = renderModalDialog(el, t, { open: true, maskClosable: false, onClose: () => closed.push(true) })
  node.props.onClick()
  assert.equal(closed.length, 0)
})
