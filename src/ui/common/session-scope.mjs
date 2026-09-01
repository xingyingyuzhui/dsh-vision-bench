// Session cwd from DSH 0.1.2-alpha.3 useWorkspaces (see ADR-011).

/**
 * @param {unknown} state
 * @param {string} sessionId
 * @returns {string}
 */
export function pathFromWorkspaceList(state, sessionId) {
  const sid = String(sessionId || '')
  const items = state && typeof state === 'object' && Array.isArray(state.items) ? state.items : []
  const hit = items.find((row) => row && Array.isArray(row.sessionIds) && sid && row.sessionIds.includes(sid))
  return hit?.path ? String(hit.path) : ''
}

/** Resolve the owning conversation session from Harness page props. Never guess from focus. */
export function pageSessionId(props) {
  return String(props?.sessionId || props?.scope?.sessionId || '')
}

function cwdFromWorkspaces(props) {
  const sessionId = pageSessionId(props)
  if (typeof props?.useWorkspaces !== 'function') return ''
  try {
    return String(props.useWorkspaces((state) => pathFromWorkspaceList(state, sessionId)) || '')
  } catch {
    return ''
  }
}

/** Resolve workspace cwd from Harness page props (useWorkspaces, then deprecated scope.cwd). */
export function sessionCwd(props) {
  const fromWorkspaces = cwdFromWorkspaces(props)
  if (fromWorkspaces) return fromWorkspaces
  // Deprecated until 0.26.0: alpha.3 pages must not rely on props.scope.cwd.
  if (props?.scope?.cwd) return String(props.scope.cwd)
  return ''
}

export function useSessionCwd(React, props) {
  void React
  return sessionCwd(props)
}

// Token-guarded active page scope — unmounting a stale session page must never
// wipe the session/cwd/view set by a newer page.
const ACTIVE_SCOPE = { token: '', sessionId: '', cwd: '', viewId: '', seq: 0 }

function applyScope(scope) {
  if (scope && typeof scope === 'object') {
    ACTIVE_SCOPE.sessionId = String(scope.sessionId || '')
    ACTIVE_SCOPE.cwd = String(scope.cwd || '')
    ACTIVE_SCOPE.viewId = String(scope.viewId || '')
    return
  }
  ACTIVE_SCOPE.sessionId = ''
  ACTIVE_SCOPE.cwd = String(scope || '')
  ACTIVE_SCOPE.viewId = ''
}

export function setActiveScope(token, scope) {
  ACTIVE_SCOPE.seq++
  ACTIVE_SCOPE.token = String(token || ACTIVE_SCOPE.seq)
  applyScope(scope)
  return ACTIVE_SCOPE.token
}
export function clearActiveScope(token) {
  if (token && token !== ACTIVE_SCOPE.token) return ACTIVE_SCOPE.cwd
  ACTIVE_SCOPE.sessionId = ''
  ACTIVE_SCOPE.cwd = ''
  ACTIVE_SCOPE.viewId = ''
  ACTIVE_SCOPE.token = ''
  return ''
}
export function getActiveScope() {
  return {
    token: ACTIVE_SCOPE.token,
    sessionId: ACTIVE_SCOPE.sessionId,
    cwd: ACTIVE_SCOPE.cwd,
    viewId: ACTIVE_SCOPE.viewId,
  }
}
