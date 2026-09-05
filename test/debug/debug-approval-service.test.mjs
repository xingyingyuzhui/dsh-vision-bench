// @ts-check

import assert from 'node:assert/strict'
import test from 'node:test'
import {
  clearDebugApprovals,
  createDebugApprovalStore,
  defaultDebugApprovals,
} from '../../src/application/debug/debug-approval-service.mjs'
import { DEBUG_ERRORS } from '../../src/domain/debug/errors.mjs'

test('debug-approval-service: create, listPending, and consume ticket lifecycle', () => {
  let currentTime = 1000
  const store = createDebugApprovalStore({
    ttlMs: 5000,
    now: () => currentTime,
  })

  // 1. Create ticket
  const ticket = store.create({
    cwd: '/workspace/stm32',
    sessionId: 'sess_alice',
    source: 'agent',
    backend: 'gdb-openocd',
    target: 'stm32f4x',
    interfaceName: 'stlink',
    artifactPath: '/build/firmware.elf',
    artifactSha256: 'abc123hash',
  })

  assert.ok(ticket.requestId.startsWith('da_'))
  assert.equal(ticket.cwd, '/workspace/stm32')
  assert.equal(ticket.sessionId, 'sess_alice')
  assert.equal(ticket.source, 'agent')
  assert.equal(ticket.target, 'stm32f4x')
  assert.equal(ticket.createdAt, 1000)
  assert.equal(ticket.expiresAt, 6000)
  assert.equal(ticket.risk, '允许对目标设备进行 halt/run/step/reset 操作')

  // 2. listPending scoped
  const pendingAlice = store.listPending({ cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(pendingAlice.length, 1)
  assert.equal(pendingAlice[0].requestId, ticket.requestId)

  const pendingBob = store.listPending({ cwd: '/workspace/stm32', sessionId: 'sess_bob' })
  assert.equal(pendingBob.length, 0)

  // 3. getPending without consuming
  const fetched = store.getPending(ticket.requestId)
  assert.ok(fetched)
  assert.equal(fetched?.requestId, ticket.requestId)
  assert.equal(store.size(), 1)

  // 4. Scope mismatch rejection
  const mismatchRes = store.consume(ticket.requestId, { cwd: '/workspace/other', sessionId: 'sess_alice' })
  assert.equal(mismatchRes.ok, false)
  assert.equal(mismatchRes.errorCode, DEBUG_ERRORS.APPROVAL_SCOPE_MISMATCH)
  assert.equal(store.size(), 1, 'ticket must not be consumed on scope mismatch')

  // 5. Successful consume
  const appRes = store.approve(ticket.requestId, { cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(appRes.ok, true)
  const consumeRes = store.consume(ticket.requestId, { cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(consumeRes.ok, true)
  assert.equal(consumeRes.record?.requestId, ticket.requestId)
  assert.equal(store.size(), 0)

  // 6. Repeat consume fails (one-shot)
  const repeatRes = store.consume(ticket.requestId, { cwd: '/workspace/stm32', sessionId: 'sess_alice' })
  assert.equal(repeatRes.ok, false)
  assert.equal(repeatRes.errorCode, DEBUG_ERRORS.APPROVAL_NOT_FOUND)
})

test('debug-approval-service: expiration removes ticket and returns APPROVAL_EXPIRED', () => {
  let currentTime = 1000
  const store = createDebugApprovalStore({
    ttlMs: 2000,
    now: () => currentTime,
  })

  const ticket = store.create({
    cwd: '/workspace/test',
    sessionId: 'sess_exp',
  })

  // Advance time beyond expiration
  currentTime = 3500

  const res = store.consume(ticket.requestId, { cwd: '/workspace/test', sessionId: 'sess_exp' })
  assert.equal(res.ok, false)
  assert.equal(res.errorCode, DEBUG_ERRORS.APPROVAL_EXPIRED)
  assert.equal(store.size(), 0)
})

test('debug-approval-service: control lease grant, query, and revoke', () => {
  const store = createDebugApprovalStore()

  assert.equal(store.hasControlLease('ds_123'), false)

  store.grantControlLease('ds_123', {
    ownerSessionId: 'sess_owner',
    workspaceCwd: '/workspace/app',
    artifactSha256: 'sha_fixed',
    backend: 'gdb-openocd',
    target: 'stm32',
  })

  assert.equal(store.hasControlLease('ds_123'), true)
  assert.equal(store.hasControlLease('ds_123', { ownerSessionId: 'sess_owner' }), true)
  assert.equal(store.hasControlLease('ds_123', { ownerSessionId: 'sess_intruder' }), false)
  assert.equal(store.hasControlLease('ds_123', { artifactSha256: 'sha_fixed' }), true)
  assert.equal(store.hasControlLease('ds_123', { artifactSha256: 'sha_changed' }), false)

  store.revokeControlLease('ds_123')
  assert.equal(store.hasControlLease('ds_123'), false)
})

test('debug-approval-service: capacity eviction and clear', () => {
  const store = createDebugApprovalStore({ max: 3 })
  const t1 = store.create({ cwd: '/a', sessionId: 's' })
  const t2 = store.create({ cwd: '/b', sessionId: 's' })
  const t3 = store.create({ cwd: '/c', sessionId: 's' })
  assert.equal(store.size(), 3)

  // 4th creates causes eviction of oldest
  const t4 = store.create({ cwd: '/d', sessionId: 's' })
  assert.equal(store.size(), 3)
  assert.equal(store.getPending(t1.requestId), null)
  assert.ok(store.getPending(t4.requestId))

  store.clear()
  assert.equal(store.size(), 0)
})

test('debug-approval-service: default singleton clear works', () => {
  defaultDebugApprovals.create({ cwd: '/test', sessionId: 's' })
  assert.ok(defaultDebugApprovals.size() > 0)
  clearDebugApprovals()
  assert.equal(defaultDebugApprovals.size(), 0)
})
