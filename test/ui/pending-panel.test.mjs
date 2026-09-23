import assert from 'node:assert/strict'
import test from 'node:test'
import { renderPendingPanel } from '../../src/ui/hmi/hmi-controller.mjs'
import { click, el } from '../helpers/react-unit.mjs'

const t = (key) =>
  ({
    pendingWrites: '待确认写点（Agent）',
    approveWrite: '批准写入',
    rejectWrite: '拒绝',
  })[key] || key

const pending = [{ id: 'w1', label: '写入转速', deviceName: '电机' }]

test('pending panel is polite live region and names each action with the request label', () => {
  const calls = []
  const node = renderPendingPanel(el, t, {
    pending,
    resolveWrite(id, approved) {
      calls.push([id, approved])
    },
  })
  assert.equal(node.props['aria-live'], 'polite')
  assert.equal(node.props['aria-busy'], undefined)
  const row = node.children[1]
  const approve = row.children[2]
  const reject = row.children[3]
  assert.equal(approve.props['aria-label'], '批准写入 写入转速')
  assert.equal(reject.props['aria-label'], '拒绝 写入转速')
  assert.equal(approve.props.disabled, false)
  click(approve)
  click(reject)
  assert.deepEqual(calls, [
    ['w1', true],
    ['w1', false],
  ])
})

test('pending panel disables actions while a request is in flight', () => {
  const node = renderPendingPanel(el, t, {
    pending,
    resolvingId: 'w1',
    resolveWrite() {},
  })
  assert.equal(node.props['aria-busy'], 'true')
  const row = node.children[1]
  assert.equal(row.children[2].props.disabled, true)
  assert.equal(row.children[3].props.disabled, true)
})
