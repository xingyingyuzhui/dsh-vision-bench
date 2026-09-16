// @ts-check
/** HMI page mount / selection helpers (P4-1). */
import assert from 'node:assert/strict'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../../bench-hmi.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win } from './react-runtime.mjs'
import { t } from './hmi-state-fixtures.mjs'

export async function selectConn(tree) {
  const connTab = Array.from(tree.container.querySelectorAll('.dvb-tab')).find((b) => b.textContent.includes('C1'))
  if (connTab) {
    await act(async () => {
      connTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    })
  }
  await new Promise((r) => setTimeout(r, 30))
}

/** Mount HMI page, select C1, wait for 温度 + switches (flags-race). */
export async function mountHmi(post) {
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  const connTab = Array.from(tree.container.querySelectorAll('.dvb-tab')).find((b) => b.textContent.includes('C1'))
  if (connTab)
    await act(async () => {
      connTab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 30))
    })
  await waitFor(() => assert.ok(tree.container.textContent.includes('温度')), { timeout: 8000 })
  await waitFor(() => assert.ok(tree.container.querySelectorAll('button.dvb-switch').length >= 2), { timeout: 8000 })
  return tree
}
