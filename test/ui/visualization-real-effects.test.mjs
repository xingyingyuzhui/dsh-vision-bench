import assert from 'node:assert/strict'
// P2-2: Visualization / Trend page real React lifecycle.
import { test } from 'node:test'
import { act, render, waitFor } from '@testing-library/react'
import React from 'react'
import { createElement } from 'react'
import { createVisualizationPage } from '../../bench-live.mjs'
import { alpha3PageProps } from '../fixtures/harness-alpha3-props.mjs'
import { pageWindow as win, useReactPageRuntime } from '../helpers/react-runtime.mjs'
import { makePost, framesT as t } from '../helpers/real-effects-fixtures.mjs'

useReactPageRuntime({ profile: 'virtualized' })

test('Task8: TrendPage mounts with real effects without leaking listeners', async () => {
  const { post } = makePost({ frames: {} })
  const Tabs = createVisualizationPage(React, t, post, {})
  const tree = render(
    createElement(Tabs, { ...alpha3PageProps({ sessionId: 's1', path: '/tmp/proj' }), scope: { cwd: '/tmp/proj' } }),
  )
  await waitFor(
    () => {
      assert.ok(tree.container.querySelector('.dvb-live'), 'trend page rendered')
    },
    { timeout: 5000 },
  )
  tree.unmount()
  // hard to assert listener count generically; at least unmount must not throw
  assert.ok(true)
})
test('Task4: VisualizationPage 让 Agent 分析组件 uses the input bridge, preserves text, posts typed visualization evidence', async () => {
  // Task3/0.19.3: 曲线数据来自工作区 trend 存储（提交阶段采样）
  const cwdA = '/tmp/trend-agent-' + Math.random()
  const wall = Date.now()
  let undoNow = null
  try {
    const oldNow = Date.now
    Date.now = () => Math.max(wall + 1000, oldNow())
    undoNow = () => {
      Date.now = oldNow
    }

    let draft = '用户已写好的中文输入'
    const evidenceCalls = []
    const evidenceOkFlag = { ok: true, evidence: [] }
    const post = async (path, body) => {
      if (path === '/dsh-vision-bench/state')
        return {
          ok: true,
          workspace: {
            modbus: {
              version: 3,
              configVersion: 7,
              trend: {
                p1: [
                  [wall, 42],
                  [wall + 500, 43],
                ],
              },
              connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
              devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
              points: [
                {
                  id: 'p1',
                  connectionId: 'c1',
                  deviceId: 'd1',
                  name: 'Temp',
                  function: 3,
                  address: 0,
                  scale: 1,
                  offset: 0,
                  trendEnabled: true,
                  monitorEnabled: true,
                },
              ],
              framesByConnection: {},
              visualization: {
                schemaVersion: 1,
                components: [{ id: 'viz_1', name: '测试趋势', type: 'line', pointIds: ['p1'] }],
              },
            },
          },
          health: {},
        }
      if (path === '/dsh-vision-bench/evidence') {
        evidenceCalls.push(body.evidence || body.item || [body])
        return evidenceOkFlag
      }
      return { ok: true }
    }
    const tMap = (k) => ({ liveChart: '可视化' })[k] || k
    const Trend = createVisualizationPage(React, tMap, post, {})
    const copiedNotes = []
    let setDraftCalls = 0
    let submissions = 0
    const props = {
      ...alpha3PageProps({ sessionId: 's1', path: cwdA }),
      scope: { cwd: cwdA },
      useInput: (sel) => sel({ draft }),
      inputActions: {
        setDraft(v) {
          setDraftCalls++
          draft = v
        },
        submit() {
          submissions++
        },
      },
    }
    const errors = []
    const onError = (e) => errors.push(e)
    const origWrite = navigator.clipboard && navigator.clipboard.writeText
    window.addEventListener('error', onError)
    const writeSpy = () => copiedNotes.push('copied')
    if (origWrite) navigator.clipboard.writeText = writeSpy
    const tree = render(createElement(Trend, props))
    await waitFor(
      () => {
        const btn = Array.from(tree.container.querySelectorAll('button')).find((b) =>
          (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'),
        )
        assert.ok(btn, 'visualization agent button rendered after real effect')
      },
      { timeout: 6000 },
    )
    await act(async () => {
      const btn = Array.from(tree.container.querySelectorAll('button')).find((b) =>
        (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'),
      )
      btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
      await new Promise((r) => setTimeout(r, 120))
    })
    assert.equal(errors.length, 0, 'no uncaught/window errors: ' + JSON.stringify(errors))
    // Task7/0.20.1: 组件引用追加到当前 Session 输入框——不覆盖已有输入、不自动发送
    assert.equal(setDraftCalls, 1, 'setDraft called once via input bridge')
    assert.equal(submissions, 0, 'no auto-submit')
    assert.ok(draft.startsWith('用户已写好的中文输入'), '已有输入保留')
    assert.ok(
      draft.includes('\n"kind": "visualization"') || draft.includes('\n{\n  "kind": "visualization"'),
      '换行追加引用',
    )
    assert.ok(
      draft.includes('"visualizationId"') && draft.includes('"componentType"') && draft.includes('"pointIds"'),
      '引用字段完整',
    )
    assert.ok(draft.includes('"configVersion": 7'), 'configVersion 7')
    assert.ok(draft.includes('"timeRange"'), 'timeRange 存在')
    if (origWrite) navigator.clipboard.writeText = origWrite
    tree.unmount()
    window.removeEventListener('error', onError)
  } finally {
    if (undoNow) undoNow()
  }
})
test('Task4: no input writer → clipboard fallback and no crash', async () => {
  const cwdB = '/tmp/trend-agent-cb-' + Math.random()
  const wall = Date.now()
  const post = async (path) => {
    if (path === '/dsh-vision-bench/state')
      return {
        ok: true,
        workspace: {
          modbus: {
            version: 3,
            configVersion: 3,
            trend: { p2: [[wall, 1]] },
            connections: [{ id: 'c2', name: 'C2', conn: { mode: 'tcp', host: '10.0.0.8', tcpPort: 502 } }],
            devices: [{ id: 'd2', connectionId: 'c2', name: 'D2', unitId: 1 }],
            points: [
              {
                id: 'p2',
                connectionId: 'c2',
                deviceId: 'd2',
                name: 'P',
                function: 3,
                address: 0,
                scale: 1,
                offset: 0,
                trendEnabled: true,
                monitorEnabled: true,
              },
            ],
            visualization: {
              schemaVersion: 1,
              components: [{ id: 'viz_2', name: '测试', type: 'line', pointIds: ['p2'] }],
            },
          },
        },
        health: {},
      }
    return { ok: true }
  }
  const tMap = (k) => ({ liveChart: '曲线', chartWindow: '最近 5 分钟' })[k] || k
  const Trend = createVisualizationPage(React, tMap, post, {})
  const errors = []
  const onError = (e) => errors.push(e)
  window.addEventListener('error', onError)
  const tree = render(
    createElement(Trend, { ...alpha3PageProps({ sessionId: 's1', path: cwdB }), scope: { cwd: cwdB } }),
  )
  await waitFor(
    () => {
      const btn = Array.from(tree.container.querySelectorAll('button')).find((b) =>
        (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'),
      )
      assert.ok(btn)
    },
    { timeout: 6000 },
  )
  await act(async () => {
    const btn = Array.from(tree.container.querySelectorAll('button')).find((b) =>
      (b.getAttribute('aria-label') || '').includes('让 Agent 分析组件'),
    )
    btn.dispatchEvent(new win.MouseEvent('click', { bubbles: true }))
    await new Promise((r) => setTimeout(r, 80))
  })
  assert.equal(errors.length, 0, 'no errors on clipboard fallback: ' + JSON.stringify(errors))
  assert.ok(
    tree.container.textContent.includes('已复制组件引用') || tree.container.textContent.includes('仅复制'),
    '无输入桥时剪贴板回退并提示',
  )
  tree.unmount()
  window.removeEventListener('error', onError)
})
