// @ts-check

import { randomBytes } from 'node:crypto'
import { DEBUG_ERRORS } from '../../domain/debug/errors.mjs'

const DEFAULT_TTL_MS = 5 * 60 * 1000
export const MAX_DEBUG_APPROVALS = 256

/** @returns {string} */
function newRequestId() {
  return `da_${Date.now().toString(36)}${randomBytes(8).toString('hex')}`
}

/**
 * @param {unknown} value
 * @returns {string}
 */
function sessionKey(value) {
  if (value == null) return ''
  return String(value)
}

/**
 * @param {unknown} left
 * @param {unknown} right
 * @returns {boolean}
 */
function sessionsMatch(left, right) {
  const a = sessionKey(left)
  const b = sessionKey(right)
  if (!a && !b) return true
  if (!a || !b) return false
  return a === b
}

/**
 * In-memory store for Debug Control Approval requests and control leases.
 * Parity with ADR-013 & Phase 6 Section 10.
 *
 * @param {{ ttlMs?: number, now?: () => number, max?: number }} [opts]
 */
export function createDebugApprovalStore(opts = {}) {
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS
  const max = Number(opts.max) > 0 ? Number(opts.max) : MAX_DEBUG_APPROVALS
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()

  /** @type {Map<string, {
   *   requestId: string,
   *   cwd: string,
   *   sessionId: string,
   *   source: 'agent' | 'user',
   *   backend: string,
   *   target: string,
   *   interfaceName: string,
   *   artifactPath: string,
   *   artifactSha256: string,
   *   risk: string,
   *   createdAt: number,
   *   expiresAt: number,
   * }>} */
  const items = new Map()

  /** @type {Map<string, {
   *   debugSessionId: string,
   *   ownerSessionId: string,
   *   workspaceCwd: string,
   *   artifactSha256: string,
   *   backend: string,
   *   target: string,
   *   grantedAt: number,
   * }>} */
  const controlLeases = new Map()

  /**
   * Purges expired tickets.
   * @param {number} [at]
   * @param {string} [exceptId]
   */
  function purgeExpired(at = now(), exceptId = '') {
    const t = at
    for (const [id, rec] of items) {
      if (exceptId && id === exceptId) continue
      if (t > rec.expiresAt) items.delete(id)
    }
    return items.size
  }

  function evictOldest() {
    while (items.size >= max) {
      const oldest = items.keys().next().value
      if (oldest == null) break
      items.delete(oldest)
    }
  }

  /**
   * Creates a new approval request ticket for starting a hardware debug session.
   *
   * @param {{
   *   cwd: string,
   *   sessionId?: string,
   *   source?: string,
   *   backend?: string,
   *   target?: string,
   *   interfaceName?: string,
   *   artifactPath?: string,
   *   artifactSha256?: string,
   * }} spec
   */
  function create(spec) {
    purgeExpired()
    evictOldest()
    const createdAt = now()
    const record = {
      requestId: newRequestId(),
      cwd: String(spec.cwd || ''),
      sessionId: sessionKey(spec.sessionId),
      source: spec.source === 'agent' ? /** @type {'agent'} */ ('agent') : /** @type {'user'} */ ('user'),
      backend: String(spec.backend || 'gdb-openocd'),
      target: String(spec.target || ''),
      interfaceName: String(spec.interfaceName || ''),
      artifactPath: String(spec.artifactPath || ''),
      artifactSha256: String(spec.artifactSha256 || ''),
      risk: '允许对目标设备进行 halt/run/step/reset 操作',
      createdAt,
      expiresAt: createdAt + ttlMs,
    }
    items.set(record.requestId, record)
    return record
  }

  /**
   * Consumes an approval request ticket once. Scope mismatch does not delete the ticket.
   *
   * @param {unknown} requestId
   * @param {{ cwd?: string, sessionId?: string }} [scope]
   */
  function consume(requestId, scope = {}) {
    const id = String(requestId || '').trim()
    if (!id) {
      return {
        ok: false,
        errorCode: DEBUG_ERRORS.APPROVAL_NOT_FOUND,
        error: '缺少调试批准请求 ID',
      }
    }
    purgeExpired(now(), id)
    const record = items.get(id)
    if (!record) {
      return {
        ok: false,
        errorCode: DEBUG_ERRORS.APPROVAL_NOT_FOUND,
        error: '调试批准请求不存在或已使用',
      }
    }
    if (now() > record.expiresAt) {
      items.delete(id)
      return {
        ok: false,
        errorCode: DEBUG_ERRORS.APPROVAL_EXPIRED,
        error: '调试批准已过期，请重新确认',
      }
    }
    if (
      (scope.cwd && String(scope.cwd) !== record.cwd) ||
      (scope.sessionId && !sessionsMatch(scope.sessionId, record.sessionId))
    ) {
      return {
        ok: false,
        errorCode: DEBUG_ERRORS.APPROVAL_SCOPE_MISMATCH,
        error: '调试批准请求不属于当前会话',
      }
    }

    items.delete(id)
    return { ok: true, record }
  }

  /**
   * Lists pending approval tickets for a session or workspace.
   * @param {{ cwd?: string, sessionId?: string }} [scope]
   */
  function listPending(scope = {}) {
    purgeExpired()
    const out = []
    for (const record of items.values()) {
      if (scope.sessionId && !sessionsMatch(scope.sessionId, record.sessionId)) continue
      if (scope.cwd && String(scope.cwd) !== record.cwd) continue
      out.push({ ...record })
    }
    return out
  }

  /**
   * Retrieves a pending ticket by ID without consuming it.
   * @param {string} requestId
   */
  function getPending(requestId) {
    purgeExpired(now(), requestId)
    const rec = items.get(String(requestId || ''))
    if (!rec || now() > rec.expiresAt) return null
    return { ...rec }
  }

  /**
   * Grants control lease to an active debug session.
   * @param {string} debugSessionId
   * @param {{
   *   ownerSessionId: string,
   *   workspaceCwd: string,
   *   artifactSha256?: string,
   *   backend?: string,
   *   target?: string,
   * }} spec
   */
  function grantControlLease(debugSessionId, spec) {
    controlLeases.set(debugSessionId, {
      debugSessionId,
      ownerSessionId: spec.ownerSessionId,
      workspaceCwd: spec.workspaceCwd,
      artifactSha256: spec.artifactSha256 || '',
      backend: spec.backend || 'gdb-openocd',
      target: spec.target || '',
      grantedAt: now(),
    })
  }

  /**
   * Checks if an active debug session has a valid control lease.
   * @param {string} debugSessionId
   * @param {{ ownerSessionId?: string, artifactSha256?: string }} [spec]
   */
  function hasControlLease(debugSessionId, spec = {}) {
    const lease = controlLeases.get(debugSessionId)
    if (!lease) return false
    if (spec.ownerSessionId && !sessionsMatch(spec.ownerSessionId, lease.ownerSessionId)) {
      return false
    }
    if (spec.artifactSha256 && lease.artifactSha256 && spec.artifactSha256 !== lease.artifactSha256) {
      return false
    }
    return true
  }

  /**
   * Revokes control lease when session closes or is invalidated.
   * @param {string} debugSessionId
   */
  function revokeControlLease(debugSessionId) {
    controlLeases.delete(debugSessionId)
  }

  function clear() {
    items.clear()
    controlLeases.clear()
  }

  function size() {
    return items.size
  }

  return {
    create,
    consume,
    listPending,
    getPending,
    grantControlLease,
    hasControlLease,
    revokeControlLease,
    purgeExpired,
    clear,
    size,
    ttlMs,
    max,
  }
}

export const defaultDebugApprovals = createDebugApprovalStore()

export function clearDebugApprovals() {
  defaultDebugApprovals.clear()
}
