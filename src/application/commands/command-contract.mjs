// @ts-check
/**
 * @typedef {import('../../types/agent-tool.js').AgentCommandEnvelope} AgentCommandEnvelope
 * @typedef {import('../../types/agent-tool.js').AgentCommandResult} AgentCommandResult
 * @typedef {import('../../types/http-api.js').HostBridgeDescriptor} HostBridgeDescriptor
 * @typedef {import('../../types/http-api.js').PostCommitWarning} PostCommitWarning
 */

export const HOST_UNAVAILABLE = 'HOST_UNAVAILABLE'
export const HOST_TIMEOUT = 'HOST_TIMEOUT'
export const HOST_UNAUTHORIZED = 'HOST_UNAUTHORIZED'
export const HOST_FORBIDDEN = 'HOST_FORBIDDEN'
export const HOST_INVALID_RESPONSE = 'HOST_INVALID_RESPONSE'
export const HOST_HTTP_TIMEOUT = HOST_TIMEOUT
export const HOST_HTTP_STATUS_ERROR = 'HOST_HTTP_STATUS_ERROR'
export const HOST_RESPONSE_INVALID = HOST_INVALID_RESPONSE
export const HOST_AUTH_FAILED = HOST_UNAUTHORIZED
export const COMMAND_ID_REUSE = 'COMMAND_ID_REUSE'
export const CONFIG_DRIFT = 'CONFIG_DRIFT'
export const OP_REMOVED = 'OP_REMOVED'

/** @returns {string} */
export function newCommandId() {
  return `cmd${Date.now().toString(36)}${Math.random().toString(36).slice(2, 10)}`
}

/**
 * @param {any} input
 * @returns {AgentCommandEnvelope}
 */
export function normalizeCommand(input) {
  const raw = input && typeof input === 'object' ? input : {}
  const payload =
    raw.payload && typeof raw.payload === 'object'
      ? raw.payload
      : raw.args && typeof raw.args === 'object'
        ? raw.args
        : raw
  const action = String(raw.action || payload.action || '').trim()
  const expected = raw.expectedConfigVersion ?? payload.expectedConfigVersion ?? payload.configVersion
  return {
    commandId: String(raw.commandId || payload.commandId || '').trim() || newCommandId(),
    home: raw.home,
    cwd: String(raw.cwd || payload.cwd || '').trim(),
    sessionId: String(raw.sessionId || payload.sessionId || '').trim(),
    source: raw.source === 'agent' || raw.source === 'system' ? raw.source : 'user',
    action,
    payload,
    expectedConfigVersion: expected == null || expected === '' ? undefined : expected,
    signal: raw.signal,
    requireHost: raw.requireHost === true,
    timeoutMs: Number(raw.timeoutMs) > 0 ? Number(raw.timeoutMs) : undefined,
  }
}

/**
 * @param {AgentCommandEnvelope} cmd
 * @param {any} result
 * @returns {AgentCommandResult}
 */
export function envelope(cmd, result) {
  const ran = result && typeof result === 'object' ? result : { ok: false, error: String(result) }
  return {
    ok: ran.ok === true,
    errorCode: ran.errorCode || ran.code || (ran.ok === true ? undefined : undefined),
    error: ran.error,
    previousConfigVersion: ran.previousConfigVersion,
    nextConfigVersion: ran.nextConfigVersion ?? ran.configVersion,
    changedIds: ran.changedIds || ran.changedPointIds || ran.changedVisualizationIds,
    changedPointIds: ran.changedPointIds,
    affectedVisualizations: ran.affectedVisualizations,
    affectedAlarms: ran.affectedAlarms,
    taskId: ran.taskId || ran.task?.id,
    transactionId: ran.transactionId,
    workspace: ran.workspace,
    ...ran,
    commandId: cmd.commandId,
    action: ran.action || cmd.action,
  }
}
