// @ts-check

const HINT = '先 status 或 points list 取得 connectionId，再带 connectionId 重试本操作'

/**
 * Host-side alarmId / trendKey locator failure, same envelope as Agent preflight.
 * @param {string} action
 * @param {{ errorCode?: string, error?: string }} rt
 * @param {string} [connectionId]
 */
export function agentLocatorError(action, rt, connectionId) {
  const cid = typeof connectionId === 'string' ? connectionId.trim() : ''
  const code = String(rt?.errorCode || 'TARGET_REQUIRED')
  const raw = String(rt?.error || '')
  if (code === 'TARGET_REQUIRED' && (raw === '缺少 connectionId' || raw === '缺少目标 ID' || !raw)) {
    return {
      ok: false,
      action,
      errorCode: 'TARGET_REQUIRED',
      error: '缺少必要参数: connectionId',
      missingFields: ['connectionId'],
      hint: HINT,
    }
  }
  return {
    ok: false,
    action,
    errorCode: code,
    error: raw || (action === 'alarm' ? 'alarmId 无法唯一定位' : 'trendKey 无法唯一定位'),
    missingFields:
      code === 'TARGET_REQUIRED' || (action === 'alarm' && !cid) ? ['connectionId'] : [],
    hint: HINT,
  }
}
