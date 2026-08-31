// @ts-check
import { randomBytes } from 'node:crypto'
import { FLASH_ERROR_CODES } from '../../domain/flash/errors.mjs'

const DEFAULT_TTL_MS = 5 * 60 * 1000

function newRequestId() {
  return `fr${Date.now().toString(36)}${randomBytes(8).toString('hex')}`
}

/**
 * In-memory one-shot flash approval tickets.
 * @param {{ ttlMs?: number, now?: () => number }} [opts]
 */
export function createFlashApprovalStore(opts = {}) {
  const ttlMs = Number(opts.ttlMs) > 0 ? Number(opts.ttlMs) : DEFAULT_TTL_MS
  const now = typeof opts.now === 'function' ? opts.now : () => Date.now()
  /** @type {Map<string, any>} */
  const items = new Map()

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
    const createdAt = now()
    const record = {
      requestId: newRequestId(),
      cwd: String(spec.cwd || ''),
      sessionId: String(spec.sessionId || ''),
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
   * Consume a ticket once. Missing/expired/mismatched tickets fail closed.
   * @param {unknown} requestId
   * @param {{ cwd: string }} scope
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
    const record = items.get(id)
    if (!record) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_NOT_FOUND,
        error: '烧录批准请求不存在或已使用',
      }
    }
    items.delete(id)
    if (String(scope?.cwd || '') !== record.cwd) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_SCOPE_MISMATCH,
        error: '烧录批准请求不属于当前工作区',
      }
    }
    if (now() > record.expiresAt) {
      return {
        ok: false,
        errorCode: FLASH_ERROR_CODES.FLASH_APPROVAL_EXPIRED,
        error: '烧录批准已过期，请重新确认',
      }
    }
    return { ok: true, record }
  }

  function clear() {
    items.clear()
  }

  return { create, consume, clear, ttlMs }
}

export const defaultFlashApprovals = createFlashApprovalStore()
