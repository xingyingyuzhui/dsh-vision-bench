import { setFocusState } from '../../../../bench-shared.mjs'

export function useAgentFocus(React, cwd, workspaceFocus) {
  const [focusState, setFocusUi] = React.useState({
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
    setFocusUi(workspaceFocus)
    try {
      setFocusState(cwd, workspaceFocus)
    } catch {
      /* focus store is optional */
    }
  }, [cwd, workspaceFocus])

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
