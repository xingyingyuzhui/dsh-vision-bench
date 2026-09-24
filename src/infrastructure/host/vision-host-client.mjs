// @ts-check
import { randomUUID } from 'node:crypto'
import {
  HOST_FORBIDDEN,
  HOST_HTTP_STATUS_ERROR,
  HOST_INVALID_RESPONSE,
  HOST_TIMEOUT,
  HOST_UNAUTHORIZED,
  HOST_UNAVAILABLE,
  normalizeCommand,
} from '../../application/commands/command-contract.mjs'
import {
  finalizeAgentCommandResult,
  losslessCommandResult,
  toLosslessJson,
} from '../../application/commands/lossless-json.mjs'

/**
 * @typedef {import('../../types/agent-tool.js').AgentCommandEnvelope} AgentCommandEnvelope
 * @typedef {import('../../types/agent-tool.js').AgentCommandResult} AgentCommandResult
 * @typedef {import('../../types/http-api.js').HostBridgeDescriptor} HostBridgeDescriptor
 * @typedef {import('../../types/http-api.js').HostPingData} HostPingData
 * @typedef {{ dispatch: (cmd: AgentCommandEnvelope) => Promise<AgentCommandResult> | AgentCommandResult }} VisionHostHandle
 */

/**
 * Load-time identity of this ESM module graph. Host `registerVisionHost` and
 * Agent `getVisionHost` share one instance iff they import the same module URL
 * in the same Node process (B2 gate).
 */
export const VISION_HOST_CLIENT_INSTANCE_ID = randomUUID()

/**
 * @typedef {{ handle: VisionHostHandle, epoch: string }} VisionHostRegistration
 */

/** @type {VisionHostRegistration | null} */
let hostRegistration = null

/**
 * @param {VisionHostHandle | null | undefined} handle
 * @returns {() => void}
 */
export function registerVisionHost(handle) {
  const valid = handle && typeof handle.dispatch === 'function' ? handle : null
  const epoch = randomUUID()
  hostRegistration = valid ? { handle: valid, epoch } : null
  return () => {
    if (hostRegistration && hostRegistration.epoch === epoch) hostRegistration = null
  }
}

export function unregisterVisionHost() {
  hostRegistration = null
}

/** @returns {VisionHostHandle | null} */
export function getVisionHost() {
  return hostRegistration?.handle ?? null
}

/** @returns {string | null} */
export function getVisionHostEpoch() {
  return hostRegistration?.epoch ?? null
}

/**
 * Explicit Web Agent bridge origin only. Never guess localhost:3080 (Desktop must not
 * accidentally hit a concurrent Web Host).
 * @returns {string}
 */
export function hostOriginOf() {
  return String(process.env.VISION_BENCH_HOST_ORIGIN || process.env.DSH_WEB_ORIGIN || '').replace(/\/$/, '')
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
  if (action === 'debug.start' || action === 'debug.stop') return 30000
  if (
    action.startsWith('debug.run') ||
    action.startsWith('debug.pause') ||
    action.startsWith('debug.step') ||
    action.startsWith('debug.inspect')
  ) {
    return 10000
  }
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
        ...(process.env.VISION_BENCH_CAPABILITY
          ? { 'x-dsh-vision-capability': process.env.VISION_BENCH_CAPABILITY }
          : {}),
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
 * Universal host command dispatcher for agent tools and internal callers.
 * In-process handle first; optional explicit HTTP bridge when `requireHost` and
 * `VISION_BENCH_HOST_ORIGIN` / `DSH_WEB_ORIGIN` are set. No implicit local
 * `executeHostCommand` fallback (that path is for test helpers / app services only).
 * @param {Partial<AgentCommandEnvelope> & { action?: string, requireHost?: boolean, timeoutMs?: number }} cmd
 * @returns {Promise<AgentCommandResult>}
 */
export async function dispatchHostCommand(cmd) {
  const input = normalizeCommand(cmd && typeof cmd === 'object' ? cmd : { action: '' })
  const source = input.source === 'agent' || input.source === 'system' ? input.source : 'user'
  const registered = hostRegistration
  if (registered?.handle && typeof registered.handle.dispatch === 'function') {
    return /** @type {AgentCommandResult} */ (
      finalizeAgentCommandResult(
        await registered.handle.dispatch(/** @type {AgentCommandEnvelope} */ (input)),
        source,
      )
    )
  }
  if (input.requireHost === true) {
    return /** @type {AgentCommandResult} */ (
      finalizeAgentCommandResult(await tryHostHttp(/** @type {AgentCommandEnvelope} */ (input)), source)
    )
  }
  return /** @type {AgentCommandResult} */ (
    finalizeAgentCommandResult(
      {
        ok: false,
        errorCode: HOST_UNAVAILABLE,
        error: 'Vision Host 不可用',
        commandId: input.commandId,
        origin: hostOriginOf() || undefined,
      },
      source,
    )
  )
}

/**
 * @param {Partial<AgentCommandEnvelope> & { action?: string, requireHost?: boolean, timeoutMs?: number }} cmd
 * @returns {Promise<AgentCommandResult>}
 */
export async function dispatchVisionCommand(cmd) {
  return dispatchHostCommand(cmd)
}

/**
 * Dispatches a vision_debug command to Host, ensuring debug. namespace prefix.
 * @param {Partial<AgentCommandEnvelope> & { action?: string, requireHost?: boolean, timeoutMs?: number }} cmd
 * @returns {Promise<AgentCommandResult>}
 */
export async function dispatchVisionDebugCommand(cmd) {
  const input = cmd && typeof cmd === 'object' ? cmd : { action: '' }
  const rawAction = String(input.action || '')
  const action = rawAction.startsWith('debug.') ? rawAction : `debug.${rawAction}`
  const payload = input.payload && typeof input.payload === 'object' ? { ...input.payload, action } : { action }
  return dispatchHostCommand({
    ...input,
    action,
    payload,
  })
}

/** @returns {HostBridgeDescriptor} */
export function describeHostBridge() {
  const origin = hostOriginOf()
  const inProcess = !!(hostRegistration?.handle && typeof hostRegistration.handle.dispatch === 'function')
  return {
    origin,
    inProcess,
    available: false,
    transport: inProcess ? 'in-process' : origin ? 'http' : 'unavailable',
  }
}

/**
 * Real side-effect-free Host probe. Never treats origin/handle existence as success.
 * @param {{ cwd?: string, sessionId?: string, commandId?: string, timeoutMs?: number, signal?: AbortSignal }} [options]
 * @returns {Promise<{ ok: boolean, available: boolean, data?: HostPingData, errorCode?: string, error?: string, origin?: string, httpStatus?: number, roundtripMs: number }>}
 */
export async function pingVisionHost(options = {}) {
  const started = Date.now()
  const inProcess = !!(hostRegistration?.handle && typeof hostRegistration.handle.dispatch === 'function')
  const result = await dispatchVisionCommand({
    action: 'system.ping',
    commandId: options.commandId || `ping-${Date.now().toString(36)}`,
    cwd: options.cwd || '',
    sessionId: options.sessionId || '',
    source: 'system',
    payload: { action: 'system.ping' },
    requireHost: true,
    timeoutMs: Number(options.timeoutMs) > 0 ? Number(options.timeoutMs) : 3000,
    signal: options.signal,
  })
  const roundtripMs = Date.now() - started
  /** @type {Record<string, unknown>} */
  let out
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
      out = {
        ok: false,
        available: false,
        errorCode: HOST_INVALID_RESPONSE,
        error: 'Host Ping 响应契约无效',
        origin: result.origin || hostOriginOf(),
        httpStatus: result.httpStatus,
        roundtripMs,
      }
    } else {
      const hostInstanceId =
        typeof raw.clientInstanceId === 'string' && raw.clientInstanceId.length > 0
          ? raw.clientInstanceId
          : undefined
      const agentPid = process.pid
      out = {
        ok: true,
        available: true,
        data: {
          service,
          version,
          transport: inProcess ? 'in-process' : 'http',
          pid,
          timestamp,
          ...(hostInstanceId ? { clientInstanceId: hostInstanceId } : {}),
          ...(typeof raw.hostFiber === 'string' ? { hostFiber: raw.hostFiber } : {}),
        },
        identity: {
          agentPid,
          hostPid: pid,
          samePid: agentPid === pid,
          localClientInstanceId: VISION_HOST_CLIENT_INSTANCE_ID,
          hostClientInstanceId: hostInstanceId ?? null,
          sameModuleInstance: hostInstanceId === VISION_HOST_CLIENT_INSTANCE_ID,
          hasHandle: inProcess,
          hostEpoch: getVisionHostEpoch(),
          agentFiber: 'dsh-vision-bench-tools',
          dispatchPath: inProcess ? 'in-process-handle' : 'http-bridge',
        },
        origin: result.origin || hostOriginOf(),
        roundtripMs,
      }
    }
  } else {
    out = {
      ok: false,
      available: false,
      errorCode: result?.errorCode,
      error: result?.error,
      origin: result?.origin || hostOriginOf(),
      httpStatus: result?.httpStatus,
      roundtripMs,
    }
  }
  return /** @type {any} */ (toLosslessJson(out) || losslessCommandResult(out))
}
