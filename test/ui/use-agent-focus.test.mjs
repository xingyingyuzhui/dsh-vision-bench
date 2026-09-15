import assert from 'node:assert/strict'
import { test } from 'node:test'
import React from 'react'
import { createElement, useEffect } from 'react'
import { focusEventKey, useAgentFocus } from '../../src/ui/hmi/hooks/use-agent-focus.mjs'
import { act, render, useReactPageRuntime } from '../helpers/react-runtime.mjs'

useReactPageRuntime({ profile: 'page' })

test('focusEventKey is stable for the same at/kind/target ids', () => {
  const a = {
    request: {
      at: 10,
      kind: 'frame',
      frameId: 'f1',
      connectionId: 'c1',
      visualizationId: '',
      alarmId: '',
      trendKey: '',
    },
  }
  const b = { request: { ...a.request } }
  assert.equal(focusEventKey(a), focusEventKey(b))
  assert.notEqual(focusEventKey(a), focusEventKey({ request: { ...a.request, at: 11 } }))
  assert.ok(focusEventKey({ request: { at: 1, visualizationId: 'v1', kind: 'visualization' } }).includes('v1'))
  assert.ok(focusEventKey({ request: { at: 1, alarmId: 'a1', kind: 'alarm' } }).includes('a1'))
  assert.ok(focusEventKey({ request: { at: 1, trendKey: 'c:d:p', kind: 'trend' } }).includes('c:d:p'))
})

function FocusProbe({ focus, sessionId, onState }) {
  const { focusState } = useAgentFocus(React, '/ws', focus, sessionId)
  useEffect(() => {
    onState(focusState)
  }, [focusState, onState])
  return null
}

test('useAgentFocus dedupes the same focus key and clears the request after 5s', async (t) => {
  t.mock.timers.enable({ apis: ['setTimeout'], now: 1_000_000 })
  const seen = []
  const focus = {
    sessionId: 's1',
    request: {
      at: 42,
      kind: 'visualization',
      visualizationId: 'viz-1',
      alarmId: '',
      trendKey: '',
      connectionId: '',
      deviceId: '',
      pointId: '',
      frameId: '',
    },
    badgeOnly: false,
  }

  const tree = render(
    createElement(FocusProbe, {
      focus,
      sessionId: 's1',
      onState: (state) => seen.push(state),
    }),
  )

  await act(async () => {})
  assert.equal(seen.at(-1)?.request?.visualizationId, 'viz-1')
  const afterFirst = seen.length

  tree.rerender(
    createElement(FocusProbe, {
      focus: { ...focus },
      sessionId: 's1',
      onState: (state) => seen.push(state),
    }),
  )
  await act(async () => {})
  assert.equal(seen.at(-1)?.request?.visualizationId, 'viz-1', 'same key keeps the shown request')
  assert.ok(seen.length >= afterFirst, 'rerender may refresh state object but must not blank the request')

  await act(async () => {
    t.mock.timers.tick(4999)
  })
  assert.ok(seen.at(-1)?.request, 'still visible just before expiry')

  await act(async () => {
    t.mock.timers.tick(1)
  })
  assert.equal(seen.at(-1)?.request, null, 'request clears after 5000ms')
  assert.equal(seen.at(-1)?.prev?.visualizationId, 'viz-1', 'previous request retained for badge')

  tree.unmount()
})
