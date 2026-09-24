// @ts-check
/**
 * Read-only Agent observe queries: focus.get + timeline.list.
 * Never persist claim, never mutate focus/UI subscriptions.
 */
import { ERROR_CODES } from '../../domain/modbus/errors.mjs'
import { isScopePartitioned } from '../../domain/modbus/config-scope.mjs'
import { loadSessionViewForRead } from '../modbus/workspace-session-view.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'

const TIMELINE_DEFAULT = 20
const TIMELINE_MAX = 50

/**
 * @param {any} request
 * @returns {any | null}
 */
function summarizeFocusRequest(request) {
  if (!request || typeof request !== 'object') return null
  return {
    kind: request.kind || '',
    connectionId: request.connectionId || '',
    deviceId: request.deviceId || '',
    pointId: request.pointId || '',
    frameId: request.frameId || '',
    trendKey: request.trendKey || '',
    alarmId: request.alarmId || '',
    visualizationId: request.visualizationId || '',
    at: Number(request.at) || 0,
    by: typeof request.by === 'string' ? request.by : '',
  }
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {string} sessionId
 * @returns {{ ok: true, workspace: any } | { ok: false, errorCode: string, error: string }}
 */
function loadObserveWorkspace(home, cwd, sessionId) {
  const sid = String(sessionId || '').trim()
  const raw = loadWorkspace(home, cwd)
  if (isScopePartitioned(raw.modbus) && !sid) {
    return {
      ok: false,
      errorCode: ERROR_CODES.SESSION_REQUIRED,
      error: '该工作区已按会话隔离，观察查询必须携带 sessionId',
    }
  }
  if (!sid) return { ok: true, workspace: raw }
  return { ok: true, workspace: loadSessionViewForRead(home, cwd, sid).workspace }
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {{ sessionId?: string }} origin
 * @returns {Promise<object>}
 */
export async function focusGet(home, cwd, origin) {
  const sid = String(origin?.sessionId || '').trim()
  const loaded = loadObserveWorkspace(home, cwd, sid)
  if (!loaded.ok) return { ok: false, action: 'focus.get', errorCode: loaded.errorCode, error: loaded.error }
  const focus = loaded.workspace.focus && typeof loaded.workspace.focus === 'object' ? loaded.workspace.focus : {}
  const owner = String(focus.sessionId || '').trim()
  const active = !!(focus.request && sid && owner === sid)
  return {
    ok: true,
    action: 'focus.get',
    active,
    sessionId: sid,
    request: active ? summarizeFocusRequest(focus.request) : null,
    badgeOnly: active ? focus.badgeOnly === true : false,
  }
}

/**
 * @param {any} event
 */
function projectTimelineEvent(event) {
  const e = event && typeof event === 'object' ? event : {}
  return {
    id: String(e.id || ''),
    at: Number(e.at) || 0,
    kind: String(e.kind || ''),
    source: String(e.source || ''),
    sessionId: String(e.sessionId || ''),
    taskId: String(e.taskId || ''),
    ok: e.ok !== false,
    summary: String(e.summary || '').slice(0, 180),
  }
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {any} args
 * @param {{ sessionId?: string }} origin
 * @returns {Promise<object>}
 */
export async function timelineList(home, cwd, args, origin) {
  const sid = String(origin?.sessionId || '').trim()
  const loaded = loadObserveWorkspace(home, cwd, sid)
  if (!loaded.ok) return { ok: false, action: 'timeline.list', errorCode: loaded.errorCode, error: loaded.error }
  const rawLimit = Number(args?.limit)
  const limit =
    Number.isFinite(rawLimit) && rawLimit > 0
      ? Math.min(TIMELINE_MAX, Math.trunc(rawLimit))
      : TIMELINE_DEFAULT
  const all = Array.isArray(loaded.workspace.timeline) ? loaded.workspace.timeline : []
  // Newest-first. Hide unattributed legacy events (empty sessionId) from Agent.
  const visible = all.filter((/** @type {any} */ e) => e && String(e.sessionId || '') === sid)
  const cursor = typeof args?.cursor === 'string' ? args.cursor.trim() : ''
  let start = 0
  if (cursor) {
    const idx = visible.findIndex((/** @type {any} */ e) => String(e?.id || '') === cursor)
    if (idx < 0) {
      return {
        ok: false,
        action: 'timeline.list',
        errorCode: 'CURSOR_EXPIRED',
        error: '时间线游标已失效（事件可能已被环形淘汰），请从第一页重读',
      }
    }
    start = idx + 1
  }
  const page = visible.slice(start, start + limit).map(projectTimelineEvent)
  const nextCursor =
    start + limit < visible.length && page.length ? page[page.length - 1].id || null : null
  return {
    ok: true,
    action: 'timeline.list',
    events: page,
    total: visible.length,
    returned: page.length,
    nextCursor,
    truncated: false,
  }
}
