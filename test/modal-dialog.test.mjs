import assert from 'node:assert/strict'
import test from 'node:test'
import { createModalDialog, renderModalDialog } from '../bench-shared.mjs'

const el = (type, props, ...children) => ({
  type,
  props: { ...(props || {}), children: children.length === 1 ? children[0] : children },
  children: children.flat(),
})

const t = (k) => k

test('renderModalDialog returns null when open is falsy or props is missing', () => {
  assert.equal(renderModalDialog(el, t, null), null)
  assert.equal(renderModalDialog(el, t, { open: false }), null)
})

test('renderModalDialog renders error alert with title, message and badges', () => {
  let closed = false
  let confirmed = false
  const node = renderModalDialog(el, t, {
    open: true,
    kind: 'err',
    title: '连接失败',
    message: '无法连接到串口 COM3',
    onClose() {
      closed = true
    },
    onConfirm() {
      confirmed = true
    },
  })

  assert.ok(node)
  assert.equal(node.props.className, 'dvb-mask')
  const dialog = node.children[0]
  assert.ok(dialog.props.className.includes('dvb-dialog'))
  assert.ok(dialog.props.className.includes('is-error'))

  // Header
  const header = dialog.children[0]
  assert.equal(header.props.className, 'dvb-dialog-header')

  // Body
  const body = dialog.children[1]
  assert.equal(body.props.className, 'dvb-dialog-body')
  assert.equal(body.children[0], '无法连接到串口 COM3')

  // Footer
  const footer = dialog.children[2]
  assert.equal(footer.props.className, 'dvb-dialog-footer')
  const confirmBtn = footer.children.find((c) => c && c.props && c.props.className.includes('dvb-btn-primary'))
  assert.ok(confirmBtn)
  confirmBtn.props.onClick()
  assert.equal(confirmed, true)

  // Close button
  const closeBtn = header.children.find((c) => c && c.props && c.props.className === 'dvb-dialog-close')
  assert.ok(closeBtn)
  closeBtn.props.onClick()
  assert.equal(closed, true)
})

test('renderModalDialog renders confirm dialog with cancel and danger confirm buttons', () => {
  let canceled = false
  let confirmed = false
  const node = renderModalDialog(el, t, {
    open: true,
    kind: 'confirm',
    title: '删除连接',
    message: '确定要删除此连接吗？',
    confirmText: '确认删除',
    cancelText: '取消',
    danger: true,
    onCancel() {
      canceled = true
    },
    onConfirm() {
      confirmed = true
    },
  })

  assert.ok(node)
  const dialog = node.children[0]
  const footer = dialog.children[2]
  const cancelBtn = footer.children.find(
    (c) => c && c.props && (c.props.children === '取消' || c.children[0] === '取消'),
  )
  assert.ok(cancelBtn)
  cancelBtn.props.onClick()
  assert.equal(canceled, true)

  const confirmBtn = footer.children.find((c) => c && c.props && c.props.className.includes('dvb-btn-danger-solid'))
  assert.ok(confirmBtn)
  confirmBtn.props.onClick()
  assert.equal(confirmed, true)
})

test('createModalDialog provides React component wrapper', () => {
  const ReactMock = { createElement: el }
  const ModalDialog = createModalDialog(ReactMock, t)
  const node = ModalDialog({
    open: true,
    title: '自定义内容',
    width: '500px',
    content: el('div', { className: 'custom-body' }, '自定义主体'),
  })

  assert.ok(node)
  const dialog = node.children[0]
  assert.deepEqual(dialog.props.style, { width: '500px' })
  const body = dialog.children[1]
  assert.equal(body.children[0].props.className, 'custom-body')
})
