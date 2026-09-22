// @ts-check
/**
 * Machine-readable refresh hints for CONFIG_DRIFT.
 * Hint only — Host still version-locks; actualVersion is not a retry credential.
 */

/**
 * @param {string} [operation]
 * @param {string} [action]
 * @param {string} [op]
 * @param {Record<string, unknown>} [target]
 * @returns {{ action: string, op?: string, visualizationId?: string }}
 */
export function configDriftRefreshHint(operation, action, op, target) {
  const raw = String(operation || '')
  const [scope, scopeOp] = raw.includes('.') ? raw.split('.', 2) : [raw, '']
  const act = String(action || '')
  const resolvedOp = String(op || scopeOp || 'list')

  if (scope === 'points' || act === 'points') {
    return { action: 'points', op: 'list' }
  }
  if (scope === 'visualization' || act === 'visualization') {
    const visualizationId =
      target && typeof target.visualizationId === 'string' ? target.visualizationId : undefined
    if (visualizationId) return { action: 'visualization', op: 'get', visualizationId }
    return { action: 'visualization', op: 'list' }
  }
  if (scope === 'connection' || act === 'configureConnection' || act === 'connect') {
    return { action: 'status' }
  }
  if (scope === 'device' || scope === 'flags' || scope === 'share') {
    return { action: 'status' }
  }
  if (act === 'config') {
    return { action: 'status' }
  }
  return { action: 'status' }
}

/**
 * @param {any} result
 * @param {{ operation?: string, action?: string, op?: string, target?: Record<string, unknown> }} [ctx]
 * @returns {any}
 */
export function attachConfigDriftRefresh(result, ctx = {}) {
  if (!result || result.ok !== false || result.errorCode !== 'CONFIG_DRIFT') return result
  if (result.refresh && typeof result.refresh === 'object') return result
  const refresh = configDriftRefreshHint(ctx.operation, ctx.action, ctx.op, ctx.target)
  const details =
    result.details && typeof result.details === 'object' ? { ...result.details, refresh } : { refresh }
  return { ...result, refresh, details }
}
