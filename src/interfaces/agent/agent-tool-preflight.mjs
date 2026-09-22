// @ts-check
/**
 * Agent-entry preflight: one structured TARGET_REQUIRED with missingFields[] + hint.
 * Host/UI paths keep multi-target ambiguity protection and are not routed here.
 *
 * alarmId / trendKey exceptions must match Host `resolveTarget`:
 * - trendKey encodes connectionId:deviceId:pointId
 * - alarmId alone is allowed only when Host can uniquely infer connection from
 *   alarmState / point table (pass optional `pack` for the same check). Without
 *   a unique locator, return missingFields including connectionId.
 */

import {
  TARGET_CODES,
  resolveTarget,
} from '../../application/modbus/target-resolver-service.mjs'

const NEEDS_CONNECTION = new Set(['frames', 'trend', 'alarm'])
const NEEDS_CONNECTION_AND_DEVICE = new Set(['read', 'write'])

/**
 * @param {any} args
 * @returns {string}
 */
function connectionIdOf(args) {
  if (typeof args?.connectionId === 'string' && args.connectionId.trim()) return args.connectionId.trim()
  if (typeof args?.connId === 'string' && args.connId.trim()) return args.connId.trim()
  return ''
}

/**
 * @param {any} args
 * @returns {string}
 */
function deviceIdOf(args) {
  return typeof args?.deviceId === 'string' && args.deviceId.trim() ? args.deviceId.trim() : ''
}

/**
 * @param {string} trendKey
 * @returns {{ ok: true, connectionId: string, deviceId: string, pointId: string } | { ok: false }}
 */
function parseTrendKey(trendKey) {
  const parts = String(trendKey || '')
    .split(':')
    .map((s) => s.trim())
  if (parts.length !== 3 || !parts[0] || !parts[1] || !parts[2]) return { ok: false }
  return { ok: true, connectionId: parts[0], deviceId: parts[1], pointId: parts[2] }
}

/**
 * @param {string} action
 * @param {string[]} missing
 * @returns {string}
 */
function hintFor(action, missing) {
  if (action === 'frames' || action === 'trend' || action === 'alarm') {
    return '先 status 或 points list 取得 connectionId，再带 connectionId 重试本操作'
  }
  if (action === 'read' || action === 'write') {
    return '先 status / points list 确认 connectionId 与 deviceId，二者都带上再读/写'
  }
  if (missing.includes('visualizationId')) {
    return 'visualization get 必须携带 visualizationId（或 id）；缺省不会默认取第一个组件'
  }
  return `补齐缺失字段后重试：${missing.join(', ')}`
}

/**
 * @param {any} [args]
 * @param {{ pack?: any }} [opts] optional Host modbus pack for alarmId/trendKey uniqueness
 * @returns {null | {
 *   ok: false,
 *   action: string,
 *   errorCode: string,
 *   error: string,
 *   missingFields: string[],
 *   hint: string,
 * }}
 */
export function validateAgentToolArgs(args, opts = {}) {
  const action = typeof args?.action === 'string' ? args.action : ''
  if (!action) {
    return {
      ok: false,
      action: '',
      errorCode: 'TARGET_REQUIRED',
      error: '缺少必要参数: action',
      missingFields: ['action'],
      hint: '每次调用必须携带 action',
    }
  }

  // Unsubscribe (alarm watch/followup false) only needs a valid session+cwd —
  // clear this session's watch first; no connectionId / alarmId required.
  const isAlarmUnsubscribe =
    action === 'alarm' && (args?.watch === false || args?.followup === false)
  if (action === 'alarm' && args?.watch !== undefined && args?.followup !== undefined) {
    if (Boolean(args.watch) !== Boolean(args.followup)) {
      return {
        ok: false,
        action,
        errorCode: 'FIELD_CONFLICT',
        error: 'watch 与 followup 语义不一致',
        missingFields: ['watch', 'followup'],
        hint: '二者同义：同为 true 订阅，同为 false 退订；不要同时传相反布尔值',
      }
    }
  }
  if (isAlarmUnsubscribe) {
    return null
  }

  /** @type {string[]} */
  const missing = []
  const cid = connectionIdOf(args)
  const did = deviceIdOf(args)
  const pack = opts.pack && typeof opts.pack === 'object' ? opts.pack : null

  if (NEEDS_CONNECTION.has(action)) {
    const hasAlarmId = typeof args?.alarmId === 'string' && args.alarmId.trim()
    const hasTrendKey = typeof args?.trendKey === 'string' && args.trendKey.trim()
    if (action === 'alarm' && hasAlarmId) {
      if (pack) {
        const rt = resolveTarget(pack, {
          connectionId: cid || undefined,
          deviceId: did || undefined,
          pointId: typeof args.pointId === 'string' ? args.pointId : undefined,
          alarmId: String(args.alarmId).trim(),
        })
        if (!rt.ok) {
          if (rt.errorCode === TARGET_CODES.TARGET_REQUIRED) {
            missing.push('connectionId')
          } else {
            return {
              ok: false,
              action,
              errorCode: rt.errorCode || 'TARGET_REQUIRED',
              error: rt.error || 'alarmId 无法唯一定位',
              missingFields: cid ? [] : ['connectionId'],
              hint: hintFor(action, ['connectionId']),
            }
          }
        }
      } else if (!cid) {
        // Without pack we cannot prove uniqueness — require connectionId.
        missing.push('connectionId')
      }
    } else if (action === 'trend' && hasTrendKey) {
      const parsed = parseTrendKey(args.trendKey)
      if (!parsed.ok) {
        missing.push('trendKey')
      } else if (cid && cid !== parsed.connectionId) {
        return {
          ok: false,
          action,
          errorCode: 'TARGET_REQUIRED',
          error: 'trendKey 与 connectionId 不一致',
          missingFields: ['connectionId'],
          hint: hintFor(action, ['connectionId']),
        }
      } else if (pack) {
        const rt = resolveTarget(pack, {
          connectionId: cid || parsed.connectionId,
          deviceId: did || parsed.deviceId,
          pointId: parsed.pointId,
          trendKey: String(args.trendKey).trim(),
        })
        if (!rt.ok) {
          return {
            ok: false,
            action,
            errorCode: rt.errorCode || 'TARGET_REQUIRED',
            error: rt.error || 'trendKey 无法唯一定位',
            missingFields: rt.errorCode === TARGET_CODES.TARGET_REQUIRED ? ['connectionId'] : [],
            hint: hintFor(action, ['connectionId']),
          }
        }
      }
    } else if (!cid) {
      missing.push('connectionId')
    }
  }

  if (NEEDS_CONNECTION_AND_DEVICE.has(action)) {
    if (!cid) missing.push('connectionId')
    if (!did) missing.push('deviceId')
  }

  if (action === 'visualization' && String(args?.op || '') === 'get') {
    const vizId =
      (typeof args?.visualizationId === 'string' && args.visualizationId.trim()) ||
      (typeof args?.id === 'string' && args.id.trim()) ||
      ''
    if (!vizId) missing.push('visualizationId')
  }

  if (!missing.length) return null

  return {
    ok: false,
    action,
    errorCode: 'TARGET_REQUIRED',
    error: `缺少必要参数: ${missing.join(', ')}`,
    missingFields: missing,
    hint: hintFor(action, missing),
  }
}
