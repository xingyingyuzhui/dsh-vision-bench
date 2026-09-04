// @ts-check

/**
 * @param {string} action
 * @param {string} code
 * @param {string} message
 * @param {Record<string, unknown>} [details]
 * @returns {{ status: 'error', action: string, error: { code: string, message: string }, details?: Record<string, unknown> }}
 */
export function keilErrorResult(action, code, message, details) {
  /** @type {{ status: 'error', action: string, error: { code: string, message: string }, details?: Record<string, unknown> }} */
  const result = {
    status: 'error',
    action,
    error: { code, message },
  }
  if (details) {
    result.details = details
  }
  return result
}
