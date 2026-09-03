// @ts-check
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { pendingState, pendingWrites, prunePendingWrites } from './modbus-runtime-context.mjs'
/**
 * @typedef {import('../../types/modbus.js').ModbusCommandBody} ModbusCommandBody
 * @typedef {{ id: string, cwd: string, createdAt: number, params: ModbusCommandBody }} PendingWriteEntry
 * @typedef {{ ok: true, entry: PendingWriteEntry } | { ok: false, errorCode: string, error: string }} TakePendingWriteResult
 */

/** @param {string} cwd @param {string} id */
const pendingKey = (cwd, id) => `${String(cwd)}:${String(id || '')}`

/** @param {unknown} value */
const sessionOf = (value) => (value ? String(value).trim() : '')

/**
 * @param {string} cwd
 * @param {ModbusCommandBody} params
 * @returns {ModbusCommandBody & { id: string }}
 */
export const createPendingWrite = (cwd, params) => {
  const id = `pw${Date.now().toString(36)}${(++pendingState.seq).toString(36)}`
  pendingWrites.set(pendingKey(cwd, id), { id, cwd, createdAt: Date.now(), params })
  prunePendingWrites()
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
