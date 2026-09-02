// @ts-check
import { VISION_RPC_CHANNEL, httpPathToRpcEndpoint } from '../../shared/vision-rpc-contract.mjs'

/**
 * @typedef {import('../../types/http-api.js').ConnectionRpcLike} ConnectionRpcLike
 */

/**
 * @param {ConnectionRpcLike} connection
 * @returns {(path: string, payload?: unknown, timeoutMs?: number) => Promise<unknown>}
 */
export function createVisionRpcPost(connection) {
  if (!connection?.rpc?.call || typeof connection.rpc.call !== 'function') {
    throw new Error('dsh-vision-bench: connection.rpc.call is required')
  }
  const rpcCall = connection.rpc.call
  if (typeof rpcCall !== 'function') {
    throw new Error('dsh-vision-bench: connection.rpc.call is required')
  }
  return function post(path, payload, timeoutMs) {
    const endpoint = httpPathToRpcEndpoint(path)
    const signal = AbortSignal.timeout(Number(timeoutMs) > 0 ? Number(timeoutMs) : 15000)
    return rpcCall(VISION_RPC_CHANNEL, endpoint, payload || {}, signal).then((result) => {
      if (!result || result.ok !== true) {
        const message =
          result && result.ok === false && result.error && typeof result.error.message === 'string'
            ? result.error.message
            : 'vision rpc failed'
        throw new Error(message)
      }
      const data = result.value
      if (data && typeof data === 'object' && 'ok' in data && data.ok === false) {
        const row = /** @type {{ error?: string }} */ (data)
        throw new Error(row.error || 'vision request failed')
      }
      return data
    })
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
  if (!result || result.ok !== true) {
    const message =
      result && result.ok === false && result.error && typeof result.error.message === 'string'
        ? result.error.message
        : 'vision rpc failed'
    throw new Error(message)
  }
  return result.value
}
