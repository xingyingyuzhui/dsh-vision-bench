// Connection presentation page-runtime (HappyDOM + RTL).
// Structural stub-el coverage stays in `connection-presentation.test.mjs`.
import assert from 'node:assert/strict'
import test from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createHmiView } from '../../bench-hmi.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { makePost, t } from '../helpers/hmi-page-fixtures.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('新建连接的添加设备窗口不会串到其他连接 tab', async () => {
  const { post } = makePost()
  const Hmi = createHmiView(React, t, post)
  const tree = render(createElement(Hmi, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }) }))
  await waitFor(() => assert.ok(tree.container.textContent.includes('C1')), { timeout: 8000 })
  const addConn = Array.from(tree.container.querySelectorAll('button')).find((b) => /＋连接/.test(b.textContent || ''))
  assert.ok(addConn, '有＋连接')
  await act(async () => {
    addConn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(() => assert.ok(tree.container.querySelector('.dvb-write-panel')), { timeout: 6000 })
  assert.ok(tree.container.textContent.includes('如 温度传感器') || tree.container.querySelector('.dvb-write-panel'))
  const c1Tab = Array.from(tree.container.querySelectorAll('.dvb-tab')).find((b) => b.textContent.includes('C1'))
  assert.ok(c1Tab, 'C1 tab')
  await act(async () => {
    c1Tab.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 40))
  })
  await waitFor(() => assert.ok(tree.container.textContent.includes('设备1')), { timeout: 6000 })
  assert.equal(!!tree.container.querySelector('.dvb-write-panel'), false, 'C1 tab 不显示新连接的添加设备窗')
  tree.unmount()
})
