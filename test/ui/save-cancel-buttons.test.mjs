// P2-1: save/cancel action group direct tests (ADR-025 D5/D6).
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createSaveCancelGroup,
  renderCancelButton,
  renderSaveButton,
  renderSaveCancelGroup,
} from '../../src/ui/components/save-cancel-buttons.mjs'
import { click, el, mockReact, text } from '../helpers/react-unit.mjs'

const t = (key) =>
  ({ save: 'Save', saving: 'Saving…', cancel: 'Cancel' })[key] ?? key

test('cancel button carries the pill class, label and accessible name', () => {
  const node = renderCancelButton(el, t, { onClick() {} })
  assert.equal(node.type, 'button')
  assert.equal(node.props.type, 'button')
  assert.ok(node.props.className.startsWith('dvb-btn-pill'))
  assert.equal(node.props['aria-label'], 'Cancel')
  assert.equal(text(node), 'Cancel')
})

test('cancel button honours an explicit text override and ariaLabel', () => {
  const node = renderCancelButton(el, t, { text: '关闭', ariaLabel: '关闭对话框' })
  assert.equal(text(node), '关闭')
  assert.equal(node.props['aria-label'], '关闭对话框')
})

test('save button is primary and disabled while saving', () => {
  const idle = renderSaveButton(el, t, { saving: false })
  assert.ok(idle.props.className.includes('dvb-btn-pill-primary'))
  assert.equal(idle.props.disabled, false)
  assert.equal(idle.props['aria-busy'], undefined)
  assert.equal(text(idle), 'Save')

  const saving = renderSaveButton(el, t, { saving: true })
  assert.equal(saving.props.disabled, true, 'saving implies disabled')
  assert.equal(saving.props['aria-busy'], 'true')
  assert.equal(text(saving), 'Saving…')
})

test('loading is a synonym of saving and sets aria-busy', () => {
  const loading = renderSaveButton(el, t, { loading: true })
  assert.equal(loading.props.disabled, true)
  assert.equal(loading.props['aria-busy'], 'true')
  assert.equal(text(loading), 'Saving…')
  assert.equal(loading.props['aria-label'], '保存中')
})

test('explicit disabled also disables the save button', () => {
  const node = renderSaveButton(el, t, { disabled: true })
  assert.equal(node.props.disabled, true)
})

test('size sm adds the shared small-button class to both buttons', () => {
  const cancel = renderCancelButton(el, t, { size: 'sm' })
  const save = renderSaveButton(el, t, { size: 'sm' })
  assert.ok(cancel.props.className.includes('dvb-btn-sm'))
  assert.ok(save.props.className.includes('dvb-btn-sm'))
})

test('group renders cancel then save and forwards both handlers', () => {
  const calls = []
  const group = renderSaveCancelGroup(el, t, {
    onCancel: () => calls.push('cancel'),
    onSave: () => calls.push('save'),
  })
  assert.ok(group.props.className.startsWith('dvb-actions'))
  assert.equal(text(group.children[0]), 'Cancel')
  assert.equal(text(group.children[1]), 'Save')
  click(group.children[0])
  click(group.children[1])
  assert.deepEqual(calls, ['cancel', 'save'])
})

test('reverseDomOrder swaps DOM order without swapping the handlers', () => {
  const calls = []
  const group = renderSaveCancelGroup(el, t, {
    reverseDomOrder: true,
    onCancel: () => calls.push('cancel'),
    onSave: () => calls.push('save'),
  })
  assert.equal(text(group.children[0]), 'Save')
  assert.equal(text(group.children[1]), 'Cancel')
  click(group.children[0])
  click(group.children[1])
  assert.deepEqual(calls, ['save', 'cancel'])
  assert.equal(group.props.style.flexDirection, 'row-reverse')
})

test('group level disabled wins over individual buttons', () => {
  const group = renderSaveCancelGroup(el, t, {
    disabled: true,
    saveDisabled: false,
    cancelDisabled: false,
  })
  assert.equal(group.children[0].props.disabled, true)
  assert.equal(group.children[1].props.disabled, true)
})

test('group forwards saving and custom copy', () => {
  const group = renderSaveCancelGroup(el, t, { saving: true, saveText: '提交', cancelText: '算了' })
  assert.equal(text(group.children[0]), '算了')
  assert.equal(group.children[0].props.disabled, false)
  assert.equal(text(group.children[1]), 'Saving…')
  assert.equal(group.children[1].props.disabled, true)
  assert.equal(group.children[1].props['aria-busy'], 'true')
})

test('group loading alias mirrors saving on the save button', () => {
  const group = renderSaveCancelGroup(el, t, { loading: true })
  assert.equal(text(group.children[1]), 'Saving…')
  assert.equal(group.children[1].props.disabled, true)
  assert.equal(group.children[1].props['aria-busy'], 'true')
  assert.equal(group.children[0].props.disabled, false)
})

test('createSaveCancelGroup wraps the render form with an injected translator', () => {
  const Group = createSaveCancelGroup(mockReact, t)
  const node = Group({ onSave() {}, onCancel() {} })
  assert.ok(node.props.className.startsWith('dvb-actions'))
  assert.equal(text(node.children[0]), 'Cancel')
})
