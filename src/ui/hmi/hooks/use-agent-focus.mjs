import { setFocusState } from '../../../../bench-shared.mjs'

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

  React.useEffect(() => {
    if (!workspaceFocus) return
    const incomingSession = String(workspaceFocus.sessionId || '')
    const currentSession = String(sessionId || '')
    const mismatch = !!(incomingSession && currentSession && incomingSession !== currentSession)
    const local = mismatch ? { ...workspaceFocus, badgeOnly: true } : workspaceFocus
    setFocusUi(local)
    try {
      setFocusState(cwd, workspaceFocus)
    } catch {
      /* focus store is optional */
    }
  }, [cwd, sessionId, workspaceFocus])

  React.useEffect(() => {
    if (!focusState.request || focusState.badgeOnly) return
    const timer = setTimeout(() => {
      setFocusUi((prev) =>
        prev?.request ? { request: null, prev: prev.request, tempWatchIds: [], badgeOnly: false, evidence: [] } : prev,
      )
    }, 5000)
    return () => clearTimeout(timer)
  }, [
    focusState.request?.connectionId,
    focusState.request?.deviceId,
    focusState.request?.pointId,
    focusState.request?.frameId,
    focusState.badgeOnly,
  ])

  return { focusState, setFocusUi, agentCopied, setAgentCopied, tempWatchNote, setTempWatchNote }
}
