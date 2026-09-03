// @ts-check
import { VISION_RPC_CHANNEL, httpPathToRpcEndpoint } from '../../shared/vision-rpc-contract.mjs'

/**
 * @typedef {import('../../types/http-api.js').ConnectionRpcLike} ConnectionRpcLike
 */

/**
 * Unwrap Connection RPC transport result.
 * Transport failure → throw. Business payloads (including ok:false) → return as-is.
 * @param {unknown} result
 * @returns {unknown}
 */
function unwrapRpcResult(result) {
  if (!result || /** @type {{ ok?: boolean }} */ (result).ok !== true) {
    const row = result && typeof result === 'object' ? /** @type {{ error?: { message?: string } }} */ (result) : null
    const message = row?.error && typeof row.error.message === 'string' ? row.error.message : 'vision rpc failed'
    throw new Error(message)
  }
  return /** @type {{ value?: unknown }} */ (result).value
}

/**
 * @param {ConnectionRpcLike} connection
 * @returns {(path: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>}
 */
export function createVisionRpcPost(connection) {
  if (!connection?.rpc?.call || typeof connection.rpc.call !== 'function') {
    throw new Error('dsh-vision-bench: connection.rpc.call is required')
  }
  const rpcCall = connection.rpc.call
  return function post(path, payload, timeoutMs) {
    const endpoint = httpPathToRpcEndpoint(path)
    const signal = AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000)
    return rpcCall(VISION_RPC_CHANNEL, endpoint, payload || {}, signal).then(unwrapRpcResult)
  }
}

/**
 * @param {ConnectionRpcLike | null | undefined} connection
 * @param {string} endpoint
 * @param {unknown} [payload]
 * @param {AbortSignal} [signal]
 * @returns {Promise<unknown>}
 */
export async function callVisionRpc(connection, endpoint, payload, signal) {
  if (!connection?.rpc?.call) {
    throw new Error('dsh-vision-bench: connection.rpc.call is required')
  }
  const result = await connection.rpc.call(VISION_RPC_CHANNEL, endpoint, payload || {}, signal)
  return unwrapRpcResult(result)
}
