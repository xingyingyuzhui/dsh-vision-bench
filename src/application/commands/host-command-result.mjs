// @ts-check
/**
 * Correlate Host dispatch outcomes with the caller's command context.
 * Order: lossless/object check → commandId check → finalize (never envelope-first).
 */
import {
  HOST_DISPATCH_FAILED,
  HOST_INVALID_RESPONSE,
} from './command-contract.mjs'
import { finalizeAgentCommandResult, toLosslessJson } from './lossless-json.mjs'

/**
 * @param {any} cmd
 * @param {string} [error]
 * @param {string} [errorCode]
 * @param {Record<string, unknown>} [extra]
 */
function failResult(cmd, error, errorCode = HOST_INVALID_RESPONSE, extra = {}) {
  return {
    ok: false,
    errorCode,
    error: error || '未能确认本次命令结果',
    commandId: cmd?.commandId,
    action: cmd?.action,
    ...extra,
  }
}

/**
 * @param {any} cmd normalized command envelope
 * @param {unknown} rawResult
 * @param {string} [source]
 * @returns {Record<string, unknown>}
 */
export function finishHostResult(cmd, rawResult, source) {
  const commandId = String(cmd?.commandId || '').trim()
  const action = String(cmd?.action || '').trim()

  if (rawResult == null || typeof rawResult !== 'object' || Array.isArray(rawResult)) {
    return finalizeAgentCommandResult(failResult(cmd, 'Host 响应无效'), source)
  }

  const cleaned = toLosslessJson(rawResult)
  if (!cleaned || typeof cleaned !== 'object' || Array.isArray(cleaned)) {
    return finalizeAgentCommandResult(failResult(cmd, 'Host 响应不是 lossless JSON'), source)
  }

  const body = /** @type {Record<string, unknown>} */ (cleaned)
  if (typeof body.ok !== 'boolean') {
    return finalizeAgentCommandResult(failResult(cmd, 'Host 响应缺少 ok'), source)
  }

  const remoteId = typeof body.commandId === 'string' ? body.commandId.trim() : ''
  if (remoteId && commandId && remoteId !== commandId) {
    return finalizeAgentCommandResult(
      failResult(cmd, '未能确认本次命令结果', HOST_INVALID_RESPONSE, {
        reason: 'command-id-mismatch',
      }),
      source,
    )
  }

  return finalizeAgentCommandResult(
    {
      ...body,
      commandId: remoteId || commandId,
      action: typeof body.action === 'string' && body.action ? body.action : action,
    },
    source,
  )
}

/**
 * In-process dispatch throw/reject → HOST_DISPATCH_FAILED (no stack / raw message).
 * @param {any} cmd
 * @param {string} [source]
 */
export function hostDispatchFailedResult(cmd, source) {
  return finishHostResult(cmd, failResult(cmd, '未能确认本次命令结果', HOST_DISPATCH_FAILED), source)
}
