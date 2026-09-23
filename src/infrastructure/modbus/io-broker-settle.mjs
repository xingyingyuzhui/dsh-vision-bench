// @ts-check
import { ioError } from '../../domain/modbus/io-contract.mjs'

/** @typedef {import('../../types/io-broker.d.ts').IoMessage} IoMessage */

/** @param {unknown} error @returns {string} */
export function thrownText(error) {
  if (error && typeof error === 'object' && 'message' in error) {
    const message = /** @type {{ message?: unknown }} */ (error).message
    return String(message || error)
  }
  return String(error)
}

/** @param {unknown} value @returns {IoMessage} */
export function asMessage(value) {
  return value && typeof value === 'object' ? /** @type {IoMessage} */ (value) : {}
}

/**
 * @param {{ settled?: boolean, timer?: ReturnType<typeof setTimeout>, abortCleanup?: () => void, resolve: (value: any) => void, reject: (error: any) => void }} entry
 * @param {{ ok?: boolean, error?: any, frames?: unknown, transactionId?: unknown, durationMs?: unknown }} result
 */
export const settlePending = (entry, result) => {
  if (!entry || entry.settled) return
  entry.settled = true
  if (entry.timer) clearTimeout(entry.timer)
  if (entry.abortCleanup) entry.abortCleanup()
  if (result.ok) entry.resolve(result)
  else {
    const error = result.error || ioError('IO_RUNTIME_CRASHED', 'I/O 运行时失败')
    if (result.frames) error.frames = result.frames
    if (result.transactionId) error.transactionId = result.transactionId
    if (result.durationMs != null) error.durationMs = result.durationMs
    entry.reject(error)
  }
}
