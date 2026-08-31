// @ts-check
import { randomBytes } from 'node:crypto'
import { FLASH_ERROR_CODES } from '../../domain/flash/errors.mjs'

const DEFAULT_TTL_MS = 5 * 60 * 1000
export const MAX_FLASH_APPROVALS = 256

function newRequestId() {
  return `fr${Date.now().toString(36)}${randomBytes(8).toString('hex')}`
}

/** @param {unknown} value */
function sessionKey(value) {
  if (value == null) return ''
  return String(value)
}

/** @param {unknown} left @param {unknown} right */
function sessionsMatch(left, right) {
  const a = sessionKey(left)
  const b = sessionKey(right)
  if (!a && !b) return true
  if (!a || !b) return false
  return a === b
}

/**
 * In-memory one-shot flash approval tickets.
 * @param {{ ttlMs?: number, now?: () => number, max?: number }} [opts]
 */
export function createFlashApprovalStore(opts = {}) {
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS
  const max = Number(opts.max) > 0 ? Number(opts.max) : MAX_FLASH_APPROVALS
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  /** @type {Map<string, any>} */
  const items = new Map()

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
   * @param {{
   *   cwd: string,
   *   sessionId?: string,
   *   source?: string,
   *   path: string,
   *   name?: string,
   *   size: number,
   *   sha256: string,
   *   interfaceName: string,
   *   target: string,
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
      source: spec.source === 'agent' ? 'agent' : 'user',
      path: String(spec.path || ''),
      name: String(spec.name || ''),
      size: Number(spec.size) || 0,
      sha256: String(spec.sha256 || ''),
      interfaceName: String(spec.interfaceName || ''),
      target: String(spec.target || ''),
      createdAt,
      expiresAt: createdAt + ttlMs,
    }
    items.set(record.requestId, record)
    return record
  }

  /**
   * Consume a ticket once. Scope mismatch does not delete the record.
   * @param {unknown} requestId
   * @param {{ cwd: string, sessionId?: string }} scope
   */
  function consume(requestId, scope) {
    const id = String(requestId || '')
    if (!id) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND,
        error: '缺少烧录批准请求',
      }
    }
    purgeExpired(now(), id)
    const record = items.get(id)
    if (!record) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND,
        error: '烧录批准请求不存在或已使用',
      }
    }
    if (now() > record.expiresAt) {
      items.delete(id)
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_EXPIRED,
        error: '烧录批准已过期，请重新确认',
      }
    }
    if (String(scope?.cwd || '') !== record.cwd || !sessionsMatch(scope?.sessionId, record.sessionId)) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH,
        error: '烧录批准请求不属于当前会话',
      }
    }
    items.delete(id)
    return { ok: true, record }
  }

  function clear() {
    items.clear()
  }

  function size() {
    return items.size
  }

  return { create, consume, purgeExpired, clear, size, ttlMs, max }
}

export const defaultFlashApprovals = createFlashApprovalStore()

export function clearFlashApprovals() {
  defaultFlashApprovals.clear()
}
