// @ts-check

export const DEBUG_ERRORS = {
  TARGET_BUSY: 'DEBUG_TARGET_BUSY',
  NOT_OWNER: 'DEBUG_SESSION_NOT_OWNER',
  STALE: 'DEBUG_SESSION_STALE',
  NOT_FOUND: 'DEBUG_SESSION_NOT_FOUND',
  INVALID_TRANSITION: 'DEBUG_INVALID_TRANSITION',
  BACKEND_UNAVAILABLE: 'DEBUG_BACKEND_UNAVAILABLE',
  COMMAND_REJECTED: 'DEBUG_COMMAND_REJECTED',
  APPROVAL_REQUIRED: 'DEBUG_APPROVAL_REQUIRED',
  APPROVAL_NOT_FOUND: 'DEBUG_APPROVAL_NOT_FOUND',
  APPROVAL_EXPIRED: 'DEBUG_APPROVAL_EXPIRED',
  APPROVAL_SCOPE_MISMATCH: 'DEBUG_APPROVAL_SCOPE_MISMATCH',
}

export class DebugError extends Error {
  /**
   * @param {string} code
   * @param {string} message
   * @param {Record<string, any>} [details]
   */
  constructor(code, message, details = {}) {
    super(message)
    this.name = 'DebugError'
    this.code = code
    this.details = details
  }
}
