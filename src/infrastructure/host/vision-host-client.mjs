// @ts-check
import {
  HOST_FORBIDDEN,
  HOST_HTTP_STATUS_ERROR,
  HOST_INVALID_RESPONSE,
  HOST_TIMEOUT,
  HOST_UNAUTHORIZED,
  HOST_UNAVAILABLE,
} from '../../application/commands/command-contract.mjs'

/**
 * @typedef {import('../../types/agent-tool.js').AgentCommandEnvelope} AgentCommandEnvelope
 * @typedef {import('../../types/agent-tool.js').AgentCommandResult} AgentCommandResult
 * @typedef {import('../../types/http-api.js').HostBridgeDescriptor} HostBridgeDescriptor
 * @typedef {import('../../types/http-api.js').HostPingData} HostPingData
 * @typedef {{ dispatch: (cmd: AgentCommandEnvelope) => Promise<AgentCommandResult> | AgentCommandResult }} VisionHostHandle
 */

/** @type {VisionHostHandle | null} */
let hostHandle = null

/**
 * @param {VisionHostHandle | null | undefined} handle
 * @returns {() => void}
 */
export function registerVisionHost(handle) {
  hostHandle = handle && typeof handle.dispatch === 'function' ? handle : null
  return () => {
    if (hostHandle === handle) hostHandle = null
  }
}

export function unregisterVisionHost() {
  hostHandle = null
}

/** @returns {VisionHostHandle | null} */
export function getVisionHost() {
  return hostHandle
}

/** @returns {string} */
export function hostOriginOf() {
  return String(process.env.VISION_BENCH_HOST_ORIGIN || process.env.DSH_WEB_ORIGIN || 'http://127.0.0.1:3080').replace(
    /\/$/,
    '',
  )
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function safeError(error) {
  const text = error instanceof Error ? error.message : String(error || '')
  return text.replace(/\/Users\/[^\s]+/g, '…').slice(0, 180)
}

/**
 * @param {string} action
 * @returns {number}
 */
function queryTimeoutMs(action) {
  if (action === 'build' || action === 'write' || action === 'map') return 120000
  if (action === 'system.ping') return 3000
  return 10000
}

/**
 * @param {number} status
 * @returns {string}
 */
function httpStatusErrorCode(status) {
  if (status === 401) return HOST_UNAUTHORIZED
  if (status === 403) return HOST_FORBIDDEN
  return HOST_HTTP_STATUS_ERROR
}

/**
 * @param {AgentCommandEnvelope} cmd
 * @returns {Promise<AgentCommandResult>}
 */
async function tryHostHttp(cmd) {
  const origin = hostOriginOf()
  if (!origin || !/^https?:\/\//i.test(origin)) {
    return {
      ok: false,
      errorCode: HOST_UNAVAILABLE,
      error: 'Host 地址缺失或无效',
      origin,
      commandId: cmd.commandId,
    }
  }
  const url = `${origin}/dsh-vision-bench/command`
  const timeoutMs = Number(cmd.timeoutMs) > 0 ? Number(cmd.timeoutMs) : queryTimeoutMs(cmd.action)
  const ac = new AbortController()
  const timer = setTimeout(() => ac.abort(), timeoutMs)
  const signal =
    cmd.signal && typeof AbortSignal.any === 'function' ? AbortSignal.any([cmd.signal, ac.signal]) : ac.signal
  try {
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'content-type': 'application/json',
        'x-dsh-vision-bench': '1',
      },
      body: JSON.stringify({
        commandId: cmd.commandId,
        cwd: cmd.cwd,
        sessionId: cmd.sessionId,
        source: cmd.source,
        action: cmd.action,
        payload: cmd.payload,
        expectedConfigVersion: cmd.expectedConfigVersion,
      }),
      signal,
    })
    let body = null
    try {
      body = await res.json()
    } catch {
      return {
        ok: false,
        errorCode: HOST_INVALID_RESPONSE,
        error: 'Host 响应不是 JSON',
        httpStatus: res.status,
        origin,
        commandId: cmd.commandId,
      }
    }
    if (!res.ok) {
      const errorCode = httpStatusErrorCode(res.status)
      return {
        ok: false,
        errorCode,
        error: String((body && typeof body === 'object' && 'error' in body && body.error) || `Host HTTP ${res.status}`),
        httpStatus: res.status,
        origin,
        commandId: cmd.commandId,
      }
    }
    if (!body || typeof body !== 'object') {
      return {
        ok: false,
        errorCode: HOST_INVALID_RESPONSE,
        error: 'Host 响应无效',
        httpStatus: res.status,
        origin,
        commandId: cmd.commandId,
      }
    }
    return { .../** @type {AgentCommandResult} */ (body), origin, httpStatus: res.status }
  } catch (error) {
    const aborted = Boolean(
      error &&
        typeof error === 'object' &&
        'name' in error &&
        (error.name === 'AbortError' || error.name === 'TimeoutError'),
    )
    return {
      ok: false,
      errorCode: aborted ? HOST_TIMEOUT : HOST_UNAVAILABLE,
      error: aborted ? 'Host 命令超时' : 'Vision Host 不可用',
      origin,
      commandId: cmd.commandId,
      detail: safeError(error),
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * @param {Partial<AgentCommandEnvelope> & { action?: string, requireHost?: boolean, timeoutMs?: number }} cmd
 * @returns {Promise<AgentCommandResult>}
 */
export async function dispatchVisionCommand(cmd) {
  const input = cmd && typeof cmd === 'object' ? cmd : { action: '' }
  if (hostHandle && typeof hostHandle.dispatch === 'function') {
    return hostHandle.dispatch(/** @type {AgentCommandEnvelope} */ (input))
  }
  if (input.requireHost !== true) {
    const { executeVisionCommand } = await import('../../application/commands/vision-command-service.mjs')
    return executeVisionCommand(input)
  }
  return tryHostHttp(/** @type {AgentCommandEnvelope} */ (input))
}

/** @returns {HostBridgeDescriptor} */
export function describeHostBridge() {
  const origin = hostOriginOf()
  const inProcess = !!(hostHandle && typeof hostHandle.dispatch === 'function')
  return {
    origin,
    inProcess,
    available: false,
    transport: inProcess ? 'in-process' : 'http',
  }
}

/**
 * Real side-effect-free Host probe. Never treats origin/handle existence as success.
 * @param {{ cwd?: string, sessionId?: string, commandId?: string, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, available: boolean, data?: HostPingData, errorCode?: string, error?: string, origin?: string, httpStatus?: number, roundtripMs: number }>}
 */
export async function pingVisionHost(options = {}) {
  const started = Date.now()
  const inProcess = !!(hostHandle && typeof hostHandle.dispatch === 'function')
  const result = await dispatchVisionCommand({
    action: 'system.ping',
    commandId: options.commandId || `ping-${Date.now().toString(36)}`,
    cwd: options.cwd || '',
    sessionId: options.sessionId || '',
    source: 'system',
    payload: { action: 'system.ping' },
    requireHost: !inProcess,
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 3000,
    signal: options.signal,
  })
  const roundtripMs = Date.now() - started
  if (result && result.ok === true) {
    const raw = result.data && typeof result.data === 'object' ? result.data : result
    const service = typeof raw.service === 'string' ? raw.service : ''
    const version = typeof raw.version === 'string' ? raw.version : ''
    const pid = typeof raw.pid === 'number' ? raw.pid : Number.NaN
    const timestamp = typeof raw.timestamp === 'string' ? raw.timestamp : ''
    const valid =
      result.action === 'system.ping' &&
      service === 'dsh-vision-bench' &&
      version.length > 0 &&
      Number.isInteger(pid) &&
      pid > 0 &&
      timestamp.length > 0 &&
      Number.isFinite(Date.parse(timestamp))
    if (!valid) {
      return {
        ok: false,
        available: false,
        errorCode: HOST_INVALID_RESPONSE,
        error: 'Host Ping 响应契约无效',
        origin: result.origin || hostOriginOf(),
        httpStatus: result.httpStatus,
        roundtripMs,
      }
    }
    return {
      ok: true,
      available: true,
      data: {
        service,
        version,
        transport: inProcess ? 'in-process' : 'http',
        pid,
        timestamp,
      },
      origin: result.origin || hostOriginOf(),
      roundtripMs,
    }
  }
  return {
    ok: false,
    available: false,
    errorCode: result?.errorCode,
    error: result?.error,
    origin: result?.origin || hostOriginOf(),
    httpStatus: result?.httpStatus,
    roundtripMs,
  }
}
