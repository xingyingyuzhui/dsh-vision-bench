import assert from 'node:assert/strict'
import test from 'node:test'
import { createEmptyState, renderEmptyState } from '../../src/ui/components/empty-state.mjs'

const el = (type, props, ...children) => ({
  type,
  props: props || {},
  children: children.flat().filter((c) => c != null && c !== false),
})

test('renderEmptyState returns null without el', () => {
  assert.equal(renderEmptyState(null, { detail: 'x' }), null)
})

test('empty kind uses status role and polite live region', () => {
  const node = renderEmptyState(el, { kind: 'empty', detail: '暂无数据' })
  assert.equal(node.props.className, 'dvb-empty')
  assert.equal(node.props['data-kind'], 'empty')
  assert.equal(node.props.role, 'status')
  assert.equal(node.props['aria-live'], 'polite')
  assert.equal(node.props['aria-busy'], undefined)
  const detail = node.children.find((c) => c.props?.className?.includes('dvb-empty-detail'))
  assert.equal(detail.children[0], '暂无数据')
})

test('loading and error kinds set ARIA correctly', () => {
  const loading = renderEmptyState(el, { kind: 'loading', title: '加载中' })
  assert.equal(loading.props['aria-busy'], 'true')
  assert.equal(loading.props.role, 'status')
  const err = renderEmptyState(el, { kind: 'error', detail: '失败' })
  assert.equal(err.props.role, 'alert')
  assert.equal(err.props['aria-live'], 'assertive')
})

test('action node is rendered without wrapping business logic', () => {
  const action = el('button', { type: 'button' }, '添加')
  const node = renderEmptyState(el, { title: '空', action })
  assert.ok(node.children.includes(action))
})

test('createEmptyState wraps renderEmptyState', () => {
  const EmptyState = createEmptyState({ createElement: el })
  const node = EmptyState({ detail: 'hint', className: 'extra' })
  assert.ok(node.props.className.includes('extra'))
})
