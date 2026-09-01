import { getActiveScope, pageSessionId, sessionCwd } from '../common/session-scope.mjs'
import { isManualNavLeaseActive, navigate } from './vision-navigation-store.mjs'

export const FOCUS_TOKEN_PREFIX = 'dvb1:'

const TARGET_KEYS = [
  'connectionId',
  'deviceId',
  'pointId',
  'frameId',
  'alarmId',
  'visualizationId',
  'trendKey',
  'file',
  'line',
]

const QUEUE = new Map()
const QUEUE_LISTENERS = new Set()

function notifyQueue() {
  for (const fn of Array.from(QUEUE_LISTENERS)) {
    try {
      fn()
    } catch {}
  }
}

export function sanitizeFocusTarget(target) {
  const src = target && typeof target === 'object' ? target : {}
  const out = {}
  for (const key of TARGET_KEYS) {
    if (src[key] == null || src[key] === '') continue
    out[key] = src[key]
  }
  return out
}

function normalizeSource(source) {
  if (source === 'manual' || source === 'init' || source === 'agent') return source
  return 'agent'
}

export function encodeFocusToken(input) {
  const payload = {
    section: String(input?.section || ''),
    target: sanitizeFocusTarget(input?.target),
    routeKey: String(input?.routeKey || ''),
    source: normalizeSource(input?.source),
  }
  return FOCUS_TOKEN_PREFIX + encodeURIComponent(JSON.stringify(payload))
}

export function decodeFocusToken(token) {
  const raw = String(token || '')
  if (!raw.startsWith(FOCUS_TOKEN_PREFIX)) return { ok: false, reason: 'prefix' }
  try {
    const parsed = JSON.parse(decodeURIComponent(raw.slice(FOCUS_TOKEN_PREFIX.length)))
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return { ok: false, reason: 'shape' }
    return {
      ok: true,
      value: {
        section: String(parsed.section || ''),
        target: sanitizeFocusTarget(parsed.target),
        routeKey: String(parsed.routeKey || ''),
        source: normalizeSource(parsed.source),
      },
    }
  } catch {
    return { ok: false, reason: 'malformed' }
  }
}

export function consumeViewRequest(viewRequest, viewId) {
  if (!viewRequest || viewRequest.view !== viewId) {
    return { consume: false, complete: false, reason: 'other-view' }
  }
  const decoded = decodeFocusToken(viewRequest.focus)
  if (!decoded.ok) {
    return { consume: false, complete: true, reason: decoded.reason || 'malformed' }
  }
  return { consume: true, complete: true, payload: decoded.value }
}

export function shouldHandleViewRequest(handledRef, key) {
  const next = String(key || '')
  if (!next || handledRef?.current === next) return false
  handledRef.current = next
  return true
}

export function enqueueVisionRequest(sessionId, request) {
  const sid = String(sessionId || '')
  if (!sid || !request || !request.viewId) return { queued: false }
  const next = {
    viewId: String(request.viewId),
    section: String(request.section || ''),
    target: sanitizeFocusTarget(request.target),
    routeKey: String(request.routeKey || ''),
    source: normalizeSource(request.source),
  }
  const prev = QUEUE.get(sid)
  if (prev?.routeKey && next.routeKey && prev.routeKey === next.routeKey) {
    return { queued: true, deduped: true }
  }
  QUEUE.set(sid, next)
  notifyQueue()
  return { queued: true, deduped: false }
}

export function peekVisionRequest(sessionId) {
  return QUEUE.get(String(sessionId || '')) || null
}

export function takeVisionRequest(sessionId, viewId) {
  const sid = String(sessionId || '')
  const rec = QUEUE.get(sid)
  if (!rec) return null
  if (viewId && rec.viewId !== viewId) return null
  QUEUE.delete(sid)
  notifyQueue()
  return rec
}

export function clearVisionRequest(sessionId) {
  const sid = String(sessionId || '')
  if (!QUEUE.has(sid)) return
  QUEUE.delete(sid)
  notifyQueue()
}

export function clearAllVisionRequests() {
  if (!QUEUE.size) return
  QUEUE.clear()
  notifyQueue()
}

export function subscribeVisionQueue(fn) {
  if (typeof fn !== 'function') return () => {}
  QUEUE_LISTENERS.add(fn)
  return () => {
    QUEUE_LISTENERS.delete(fn)
  }
}

function pagePropsFromScope() {
  const active = getActiveScope()
  return {
    sessionId: active.sessionId,
    scope: { sessionId: active.sessionId, cwd: active.cwd },
    openView: active.openView,
  }
}

function routeKeyOf(sessionId, cwd, viewId, payload) {
  if (payload?.routeKey) return String(payload.routeKey)
  const target = sanitizeFocusTarget(payload?.target)
  return [
    String(sessionId || ''),
    String(cwd || ''),
    String(viewId || ''),
    String(payload?.section || ''),
    target.connectionId || '',
    target.deviceId || '',
    target.pointId || '',
    target.frameId || '',
    target.visualizationId || '',
    target.alarmId || '',
    target.trendKey || '',
    target.file || '',
  ].join('|')
}

export function requestOpenView(props, viewId, payload) {
  const sessionId = pageSessionId(props)
  const cwd = sessionCwd(props)
  const section = String(payload?.section || '')
  const target = sanitizeFocusTarget(payload?.target)
  const source = normalizeSource(payload?.source)
  const routeKey = routeKeyOf(sessionId, cwd, viewId, { ...payload, section, target })
  const request = { viewId, section, target, routeKey, source }
  const nav = navigate(sessionId, cwd, { viewId, section, target }, { source })
  if (source === 'agent' && nav && nav.applied === false) {
    enqueueVisionRequest(sessionId, request)
    return { ok: true, applied: false, mode: 'badge', routeKey }
  }
  const active = getActiveScope()
  if (active.viewId === viewId) {
    clearVisionRequest(sessionId)
    return { ok: true, applied: true, mode: 'same-view', routeKey }
  }
  const openView = typeof props?.openView === 'function' ? props.openView : active.openView
  if (typeof openView !== 'function') {
    enqueueVisionRequest(sessionId, request)
    return { ok: true, applied: false, mode: 'queued', routeKey }
  }
  openView(viewId, encodeFocusToken(request))
  return { ok: true, applied: true, mode: 'open-view', routeKey }
}

export function requestOpenViewFromScope(viewId, payload) {
  return requestOpenView(pagePropsFromScope(), viewId, payload)
}

export function acceptQueuedVisionRequest(props) {
  const sessionId = pageSessionId(props)
  const rec = peekVisionRequest(sessionId)
  if (!rec) return { ok: false, applied: false, mode: 'empty' }
  takeVisionRequest(sessionId)
  return requestOpenView(props, rec.viewId, { ...rec, source: 'manual' })
}

export function applyConsumedViewRequest(sessionId, cwd, viewId, payload) {
  const source = normalizeSource(payload?.source)
  if (source === 'agent' && isManualNavLeaseActive(sessionId, cwd)) {
    enqueueVisionRequest(sessionId, {
      viewId,
      section: payload?.section,
      target: payload?.target,
      routeKey: payload?.routeKey,
      source,
    })
    return { applied: false, mode: 'badge' }
  }
  navigate(sessionId, cwd, { viewId, section: payload?.section || '', target: payload?.target }, { source })
  clearVisionRequest(sessionId)
  return { applied: true, mode: 'applied' }
}
