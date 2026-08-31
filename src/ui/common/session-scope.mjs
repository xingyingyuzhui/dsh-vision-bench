// Session cwd + active page scope (split from bench-live / bench-shared).

/** Resolve workspace cwd from Harness page props (scope.cwd or useSessions). */
export function sessionCwd(props) {
  if (props?.scope?.cwd) return props.scope.cwd
  const sessionId = pageSessionId(props)
  return props?.useSessions
    ? props.useSessions((s) => {
        if (sessionId && s.byId && s.byId[sessionId] && s.byId[sessionId].cwd) return s.byId[sessionId].cwd
        const id = s?.current
        return (s?.byId && id && s.byId[id] && s.byId[id].cwd) || ''
      })
    : ''
}

/** Resolve the owning conversation session from Harness page props. Never guess from focus. */
export function pageSessionId(props) {
  return String(props?.sessionId || props?.scope?.sessionId || '')
}

export function useSessionCwd(React, props) {
  void React
  const sessionId = props?.sessionId
  return props?.useSessions
    ? props.useSessions((s) => (s.byId && sessionId && s.byId[sessionId] && s.byId[sessionId].cwd) || '')
    : ''
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
