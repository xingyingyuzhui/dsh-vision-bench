import assert from 'node:assert/strict'
import test from 'node:test'
import { render } from '@testing-library/react'
import React from 'react'
import { portalChildren, toBodyPortal } from '../../src/ui/common/body-portal.mjs'
import { createKeilPickerDialog } from '../../src/ui/debug/keil/keil-picker-dialog.mjs'
import { createVizEditorPanel } from '../../src/ui/monitor/visualization/components/viz-editor-panel.mjs'
import { useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('toBodyPortal uses the React portal protocol on document.body', () => {
  const child = { type: 'div', props: { className: 'dvb-mask' } }
  const portal = toBodyPortal(child)
  assert.equal(portal.$$typeof, Symbol.for('react.portal'))
  assert.equal(portal.containerInfo, document.body)
  assert.equal(portalChildren(portal), child)
  assert.equal(toBodyPortal(null), null)
})

test('viz editor dialog mounts on document.body, not inside the conversation tree', () => {
  const Panel = createVizEditorPanel(React, (key) => key)
  const tree = render(
    React.createElement('div', { className: 'dvb-ws-pane', 'data-active': 'true' }, React.createElement(Panel, {
      editor: { name: '组件1', type: 'line', pointIds: [], settings: { windowMs: 60000 } },
      setEditor() {},
      onSave() {},
      onCancel() {},
    })),
  )
  const mask = document.body.querySelector('.dvb-viz-modal-mask')
  assert.ok(mask, 'mask is in the document')
  assert.equal(mask.parentElement, document.body, 'mask is a direct child of body')
  assert.equal(tree.container.querySelector('.dvb-viz-modal-mask'), null, 'mask is not trapped in the pane')
  tree.unmount()
  assert.equal(document.body.querySelector('.dvb-viz-modal-mask'), null)
})

test('keil picker dialog mounts on document.body, not inside the conversation tree', () => {
  const Dialog = createKeilPickerDialog(React, (key) => key)
  const tree = render(
    React.createElement(
      'div',
      { className: 'dvb-ws-pane' },
      React.createElement(Dialog, {
        picker: { path: '/ws', parent: '', dirs: [], files: [] },
        busy: false,
        openPicker() {},
        chooseProject() {},
        onClose() {},
      }),
    ),
  )
  const mask = document.body.querySelector('.dvb-mask')
  assert.ok(mask, 'mask is in the document')
  assert.equal(mask.parentElement, document.body, 'mask is a direct child of body')
  assert.equal(tree.container.querySelector('.dvb-mask'), null, 'mask is not trapped in the pane')
  tree.unmount()
  assert.equal(document.body.querySelector('.dvb-mask'), null)
})
