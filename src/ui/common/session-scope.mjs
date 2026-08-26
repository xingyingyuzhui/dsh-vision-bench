// Session cwd + active sidebar scope (split from bench-live / bench-shared).

/** Resolve workspace cwd from Harness page props (scope.cwd or useSessions). */
export function sessionCwd(props) {
  if (props?.scope?.cwd) return props.scope.cwd
  const sessionId = props?.scope?.sessionId || props?.sessionId
  return props?.useSessions
    ? props.useSessions((s) => {
        if (sessionId && s.byId && s.byId[sessionId] && s.byId[sessionId].cwd) return s.byId[sessionId].cwd
        const id = s?.current
        return (s?.byId && id && s.byId[id] && s.byId[id].cwd) || ''
      })
    : ''
}

export function useSessionCwd(React, props) {
  void React
  const sessionId = props?.sessionId
  return props?.useSessions
    ? props.useSessions((s) => (s.byId && sessionId && s.byId[sessionId] && s.byId[sessionId].cwd) || '')
    : ''
}

// Task2/0.18.4: token-guarded active sidebar scope — unmounting a stale session
// page must never wipe the cwd set by a newer session.
const ACTIVE_SCOPE = { token: '', cwd: '', seq: 0 }
export function setActiveScope(token, cwd) {
  ACTIVE_SCOPE.seq++
  ACTIVE_SCOPE.token = String(token || ACTIVE_SCOPE.seq)
  ACTIVE_SCOPE.cwd = String(cwd || '')
  return ACTIVE_SCOPE.token
}
export function clearActiveScope(token) {
  if (token && token !== ACTIVE_SCOPE.token) return ACTIVE_SCOPE.cwd
  ACTIVE_SCOPE.cwd = ''
  ACTIVE_SCOPE.token = ''
  return ''
}
export function getActiveScope() {
  return { token: ACTIVE_SCOPE.token, cwd: ACTIVE_SCOPE.cwd }
}
