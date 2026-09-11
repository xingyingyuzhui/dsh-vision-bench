// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { checkDebugApprovalScope, checkFlashApprovalScope, compareApprovalCwd } from '../../src/shared/approval-scope.mjs'

test('compareApprovalCwd 区分 match / mismatch / unknown', () => {
  assert.equal(compareApprovalCwd('/ws', '/ws'), 'match')
  assert.equal(compareApprovalCwd('/ws', '/other'), 'mismatch')
  assert.equal(compareApprovalCwd('', '/ws'), 'unknown')
  assert.equal(compareApprovalCwd('/ws', undefined), 'unknown')
})

test('debug 策略：cwd 不同则拒绝', () => {
  const denied = checkDebugApprovalScope({ cwd: '/ws-b', sessionId: 'x' }, { cwd: '/ws-a', sessionId: 'y' })
  assert.equal(denied.ok, false)
})

test('debug 策略：cwd 相同、sessionId 不同则放行（GUI 审批 Agent 工单）', () => {
  // 这是 B2-a 的核心：审批来自 Debug 页，它不知道发起方 Agent 的 sessionId。
  const allowed = checkDebugApprovalScope({ cwd: '/ws', sessionId: 'gui_page' }, { cwd: '/ws', sessionId: 'agent_A' })
  assert.equal(allowed.ok, true)
})

test('debug 策略：完全没有 scope 时放行（内部 approve(requestId)，requestId 本身即能力）', () => {
  assert.equal(checkDebugApprovalScope(undefined, { cwd: '/ws', sessionId: 'agent_A' }).ok, true)
  assert.equal(checkDebugApprovalScope({}, { cwd: '/ws', sessionId: 'agent_A' }).ok, true)
})

test('flash 策略：cwd 与 sessionId 都必须精确匹配', () => {
  const rec = { cwd: '/ws', sessionId: 'sess-a' }
  assert.equal(checkFlashApprovalScope({ cwd: '/ws', sessionId: 'sess-a' }, rec).ok, true)
  assert.equal(checkFlashApprovalScope({ cwd: '/ws', sessionId: 'sess-b' }, rec).ok, false)
  assert.equal(checkFlashApprovalScope({ cwd: '/other', sessionId: 'sess-a' }, rec).ok, false)
})

test('flash 策略：缺少 cwd 或缺少 sessionId 都拒绝（失败关闭）', () => {
  assert.equal(checkFlashApprovalScope({ sessionId: 'sess-a' }, { cwd: '/ws', sessionId: 'sess-a' }).ok, false)
  assert.equal(checkFlashApprovalScope({ cwd: '/ws' }, { cwd: '/ws', sessionId: 'sess-a' }).ok, false)
  assert.equal(checkFlashApprovalScope({ cwd: '/ws', sessionId: 'sess-a' }, { cwd: '/ws' }).ok, false)
})

test('flash 策略：双方都没有 sessionId 时视为匹配', () => {
  assert.equal(checkFlashApprovalScope({ cwd: '/ws' }, { cwd: '/ws' }).ok, true)
})

test('两个策略的差异是显式且有意为之', () => {
  const scope = { cwd: '/ws', sessionId: 'gui_page' }
  const rec = { cwd: '/ws', sessionId: 'agent_A' }
  // 同一组输入：debug 放行（GUI 不知道 Agent 会话），flash 拒绝（烧录绑定归属会话）
  assert.equal(checkDebugApprovalScope(scope, rec).ok, true)
  assert.equal(checkFlashApprovalScope(scope, rec).ok, false)
})
