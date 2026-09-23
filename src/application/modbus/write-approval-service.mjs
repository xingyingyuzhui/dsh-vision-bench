// @ts-check
import { randomBytes } from 'node:crypto'
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { pendingWrites, prunePendingWrites } from './modbus-runtime-context.mjs'
/**
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 * @typedef {{ id: string, cwd: string, createdAt: number, params: ModbusCommandBody }} PendingWriteEntry
 * @typedef {{ ok: true, entry: PendingWriteEntry } | { ok: false, errorCode: string, error: string }} TakePendingWriteResult
 */

/** @param {string} cwd @param {string} id */
const pendingKey = (cwd, id) => `${String(cwd)}:${String(id || '')}`

/** @param {unknown} value */
const sessionOf = (value) => (value ? String(value).trim() : '')

const PENDING_WRITE_LIMIT = 20

/**
 * @param {unknown} left
 * @param {unknown} right
 */
const sameValues = (left, right) => {
  const a = Array.isArray(left) ? left : []
  const b = Array.isArray(right) ? right : []
  return a.length === b.length && a.every((value, index) => value === b[index])
}

/**
 * @param {ModbusCommandBody | undefined} params
 */
const fingerprintOf = (params) => ({
  sessionId: sessionOf(params?.sessionId),
  connectionId: sessionOf(params?.connectionId || params?.connId),
  deviceId: sessionOf(params?.deviceId),
  function: Number(params?.function),
  address: Number(params?.address),
})

/**
 * @param {string} cwd
 * @param {ModbusCommandBody} params
 * @returns {(ModbusCommandBody & { id: string, deduped?: true }) | { ok: false, errorCode: string, error: string }}
 */
export const createPendingWrite = (cwd, params) => {
  prunePendingWrites()
  const next = fingerprintOf(params)
  for (const entry of pendingWrites.values()) {
    if (entry.cwd !== cwd) continue
    const prev = fingerprintOf(entry.params)
    if (
      prev.sessionId === next.sessionId &&
      prev.connectionId === next.connectionId &&
      prev.deviceId === next.deviceId &&
      prev.function === next.function &&
      prev.address === next.address &&
      sameValues(entry.params?.values, params?.values)
    ) {
      return { id: entry.id, ...entry.params, deduped: true }
    }
  }
  let count = 0
  for (const entry of pendingWrites.values()) {
    if (entry.cwd === cwd) count += 1
  }
  if (count >= PENDING_WRITE_LIMIT) {
    return {
      ok: false,
      errorCode: ERROR_CODES.APPROVAL_QUEUE_FULL,
      error: '待批准写点已达上限',
    }
  }
  const id = randomBytes(8).toString('hex')
  pendingWrites.set(pendingKey(cwd, id), { id, cwd, createdAt: Date.now(), params })
  return { id, ...params }
}

/**
 * Find a pending write without consuming it.
 * @param {string} cwd
 * @param {string} id
 * @returns {PendingWriteEntry | null}
 */
export const peekPendingWrite = (cwd, id) => {
  prunePendingWrites()
  return pendingWrites.get(pendingKey(cwd, id)) || null
}

/**
 * Validate session ownership and consume the entry in one step. On any
 * failure the entry stays in the map so the owning session can still act on it.
 * @param {string} cwd
 * @param {string} id
 * @param {string | undefined} sessionId
 * @returns {TakePendingWriteResult}
 */
export const takePendingWrite = (cwd, id, sessionId) => {
  const entry = peekPendingWrite(cwd, id)
  if (!entry) {
    return { ok: false, errorCode: ERROR_CODES.PENDING_WRITE_NOT_FOUND, error: '请求不存在或已过期' }
  }
  const owner = sessionOf(entry.params.sessionId)
  const caller = sessionOf(sessionId)
  if (owner && !caller) {
    return { ok: false, errorCode: ERROR_CODES.SESSION_REQUIRED, error: '批准写点请求必须携带当前会话' }
  }
  if (owner && owner !== caller) {
    return { ok: false, errorCode: ERROR_CODES.SESSION_MISMATCH, error: '该写点请求不属于当前会话' }
  }
  pendingWrites.delete(pendingKey(cwd, id))
  return { ok: true, entry }
}

/**
 * Put a consumed approval back. Used when the write cannot start (the bus is
 * busy) so the user can approve the same request again.
 * @param {PendingWriteEntry | null | undefined} entry
 */
export const restorePendingWrite = (entry) => {
  if (!entry || !entry.id || !entry.cwd) return
  pendingWrites.set(pendingKey(entry.cwd, entry.id), entry)
}

/**
 * Pending writes visible to a session. Without a session nothing is visible so
 * an anonymous browser can never observe (or approve) another session's requests.
 * Requests raised without a session are unowned and visible to every session.
 * @param {string} cwd
 * @param {string | undefined} sessionId
 */
export const listPendingWrites = (cwd, sessionId) => {
  prunePendingWrites()
  const caller = sessionOf(sessionId)
  if (!caller) return []
  const out = []
  for (const entry of pendingWrites.values()) {
    if (entry.cwd !== cwd) continue
    const owner = sessionOf(entry.params.sessionId)
    if (owner && owner !== caller) continue
    out.push({ id: entry.id, ...entry.params })
  }
  return out
}
