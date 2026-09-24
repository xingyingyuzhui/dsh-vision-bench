// @ts-check
/**
 * Stable points list pagination for Agent (and explicit Host callers).
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'

const AGENT_DEFAULT_LIMIT = 20
const AGENT_MAX_LIMIT = 50

/**
 * Locale-independent sort key.
 * @param {any} p
 * @returns {[string, string, string]}
 */
export function pointSortKey(p) {
  return [String(p?.connectionId || p?.connId || ''), String(p?.deviceId || ''), String(p?.id || '')]
}

/**
 * @param {any} a
 * @param {any} b
 */
export function comparePointRows(a, b) {
  const ka = pointSortKey(a)
  const kb = pointSortKey(b)
  for (let i = 0; i < 3; i += 1) {
    if (ka[i] < kb[i]) return -1
    if (ka[i] > kb[i]) return 1
  }
  return 0
}

/**
 * @param {{
 *   configVersion: number,
 *   sessionId: string,
 *   connectionId: string,
 *   deviceId: string,
 *   view: string,
 *   last?: [string, string, string],
 * }} parts
 */
export function encodeListCursor(parts) {
  return Buffer.from(JSON.stringify(parts), 'utf8').toString('base64url')
}

/**
 * @param {string} cursor
 * @returns {any | null}
 */
export function decodeListCursor(cursor) {
  try {
    const raw = Buffer.from(String(cursor || ''), 'base64url').toString('utf8')
    const parsed = JSON.parse(raw)
    if (!parsed || typeof parsed !== 'object') return null
    return parsed
  } catch {
    return null
  }
}

/**
 * @param {string} a
 * @param {string} b
 * @param {string} c
 * @param {string} d
 */
function fingerprint(a, b, c, d) {
  return `${a}|${b}|${c}|${d}`
}

/**
 * @param {{
 *   points: any[],
 *   configVersion: number,
 *   sessionId: string,
 *   connectionId: string,
 *   deviceId: string,
 *   view: 'full' | 'summary',
 *   limit: number | undefined,
 *   cursor: string,
 *   isAgent: boolean,
 * }} input
 */
export function pagePointsList(input) {
  const view = input.view === 'summary' ? 'summary' : 'full'
  const sorted = [...(Array.isArray(input.points) ? input.points : [])].sort(comparePointRows)
  const total = sorted.length
  const wantPaging = input.isAgent || input.limit != null || !!input.cursor
  if (!wantPaging) {
    return {
      ok: true,
      points: sorted,
      total,
      returned: sorted.length,
      nextCursor: null,
      truncated: false,
      view,
      configVersion: input.configVersion,
    }
  }

  let limit = Number(input.limit)
  if (!Number.isFinite(limit) || limit <= 0) {
    limit = input.isAgent ? AGENT_DEFAULT_LIMIT : total || AGENT_DEFAULT_LIMIT
  }
  limit = Math.trunc(limit)
  if (input.isAgent) limit = Math.min(AGENT_MAX_LIMIT, Math.max(1, limit))
  else limit = Math.max(1, limit)

  const fp = fingerprint(input.sessionId, input.connectionId, input.deviceId, view)
  let start = 0
  if (input.cursor) {
    const decoded = decodeListCursor(input.cursor)
    if (!decoded) {
      return {
        ok: false,
        errorCode: 'CURSOR_EXPIRED',
        error: 'points list 游标无效，请从第一页重读',
      }
    }
    if (Number(decoded.configVersion) !== Number(input.configVersion)) {
      return {
        ok: false,
        errorCode: ERROR_CODES.CONFIG_DRIFT,
        error: '配置已变更，请用新的 configVersion 从第一页重读',
        refresh: { configVersion: input.configVersion },
      }
    }
    const cursorFp = fingerprint(
      String(decoded.sessionId || ''),
      String(decoded.connectionId || ''),
      String(decoded.deviceId || ''),
      String(decoded.view || 'full'),
    )
    // Cursor must not retarget authorization — session comes from origin only.
    if (String(decoded.sessionId || '') !== String(input.sessionId || '') || cursorFp !== fp) {
      return {
        ok: false,
        errorCode: 'CURSOR_EXPIRED',
        error: 'points list 游标与当前会话/过滤器不匹配，请从第一页重读',
      }
    }
    const last = Array.isArray(decoded.last) ? decoded.last.map(String) : null
    if (!last || last.length !== 3) {
      return {
        ok: false,
        errorCode: 'CURSOR_EXPIRED',
        error: 'points list 游标无效，请从第一页重读',
      }
    }
    start = sorted.findIndex((p) => comparePointRows(p, { connectionId: last[0], deviceId: last[1], id: last[2] }) > 0)
    if (start < 0) start = sorted.length
  }

  const page = sorted.slice(start, start + limit)
  /** @type {string | null} */
  let nextCursor = null
  if (start + limit < total && page.length) {
    const last = page[page.length - 1]
    nextCursor = encodeListCursor({
      configVersion: input.configVersion,
      sessionId: input.sessionId,
      connectionId: input.connectionId,
      deviceId: input.deviceId,
      view,
      last: pointSortKey(last),
    })
  }
  return {
    ok: true,
    points: page,
    total,
    returned: page.length,
    nextCursor,
    truncated: false,
    view,
    configVersion: input.configVersion,
  }
}

/**
 * @param {any} row
 * @param {'full' | 'summary'} view
 */
export function projectPointListRow(row, view) {
  if (view !== 'summary') return row
  return {
    id: row.id,
    name: row.name,
    connectionId: row.connectionId || row.connId || '',
    deviceId: row.deviceId || '',
    valueStatus: row.valueStatus,
  }
}
