import { setFocusState } from '../../../../bench-shared.mjs'

export function focusEventKey(focus) {
  const r = focus?.request
  if (!r || typeof r !== 'object') return ''
  return [
    r.at || '',
    r.kind || '',
    r.connectionId || '',
    r.deviceId || '',
    r.pointId || '',
    r.frameId || '',
    r.visualizationId || '',
    r.alarmId || '',
    r.trendKey || '',
  ].join('|')
}

export function useAgentFocus(React, cwd, workspaceFocus, sessionId) {
  const [focusState, setFocusUi] = React.useState({
    sessionId: '',
    request: null,
    prev: null,
    tempWatchIds: [],
    badgeOnly: false,
    evidence: [],
  })
  const [agentCopied, setAgentCopied] = React.useState('')
  const [tempWatchNote, setTempWatchNote] = React.useState('')
  const lastShownFocusKey = React.useRef('')
  const focusRef = React.useRef(workspaceFocus)
  focusRef.current = workspaceFocus

  const incomingSession = String(workspaceFocus?.sessionId || '')
  const currentSession = String(sessionId || '')
  const mismatch = !!(incomingSession && currentSession && incomingSession !== currentSession)
  const req = workspaceFocus?.request

  React.useEffect(() => {
    const incoming = focusRef.current
    if (!incoming) return
    const local = mismatch ? { ...incoming, badgeOnly: true } : incoming
    const key = focusEventKey(local)
    if (key && lastShownFocusKey.current === key) return
    if (key && local.request && !local.badgeOnly) lastShownFocusKey.current = key
    setFocusUi(local)
    try {
      setFocusState(cwd, incoming)
    } catch {
      /* focus store is optional */
    }
  }, [
    cwd,
    sessionId,
    mismatch,
    req?.at,
    req?.kind,
    req?.connectionId,
    req?.deviceId,
    req?.pointId,
    req?.frameId,
    req?.visualizationId,
    req?.alarmId,
    req?.trendKey,
    workspaceFocus?.badgeOnly,
  ])

  React.useEffect(() => {
    if (!focusState.request || focusState.badgeOnly) return
    const timer = setTimeout(() => {
      setFocusUi((prev) =>
        prev?.request
          ? {
              sessionId: prev.sessionId || '',
              request: null,
              prev: prev.request,
              tempWatchIds: [],
              badgeOnly: false,
              evidence: [],
            }
          : prev,
      )
    }, 5000)
    return () => clearTimeout(timer)
  }, [
    focusState.request?.at,
    focusState.request?.kind,
    focusState.request?.connectionId,
    focusState.request?.deviceId,
    focusState.request?.pointId,
    focusState.request?.frameId,
    focusState.request?.visualizationId,
    focusState.request?.alarmId,
    focusState.request?.trendKey,
    focusState.badgeOnly,
  ])

  return { focusState, setFocusUi, agentCopied, setAgentCopied, tempWatchNote, setTempWatchNote }
}
