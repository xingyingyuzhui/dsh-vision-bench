import { emptyJournal, emptyWorkspace, pickJournal, subscribeState } from '../../../../bench-shared.mjs'

export function useHmiState(React, post, cwd, sessionId) {
  const [health, setHealth] = React.useState({})
  const [ioRuntime, setIoRuntime] = React.useState({})
  const [workspace, setWorkspace] = React.useState(emptyWorkspace)
  const [journal, setJournal] = React.useState(emptyJournal)
  const [pending, setPending] = React.useState([])
  const [connectionStates, setConnectionStates] = React.useState([])
  const workspaceRef = React.useRef(workspace)
  workspaceRef.current = workspace
  const inflight = React.useRef(0)
  const flagInflight = React.useRef(0)

  React.useEffect(() => {
    setWorkspace(emptyWorkspace())
    setJournal(emptyJournal())
    setPending([])
    setConnectionStates([])
    setHealth({})
    setIoRuntime({})
  }, [cwd, sessionId])

  React.useEffect(
    () =>
      subscribeState(
        post,
        cwd,
        (data) => {
          if (!data) return
          if (data.health) setHealth(data.health)
          if (data.ioRuntime) setIoRuntime(data.ioRuntime)
          if (Array.isArray(data.connectionStates)) setConnectionStates(data.connectionStates)
          if (Array.isArray(data.pendingWrites)) setPending(data.pendingWrites)
          setJournal(pickJournal(data))
          if (inflight.current > 0 || flagInflight.current > 0) return
          if (data.workspace) {
            setWorkspace((prev) => ({
              ...prev,
              modbus: data.workspace.modbus || prev.modbus,
              focus: data.workspace.focus || prev.focus,
            }))
          }
        },
        { sessionId },
      ),
    [cwd, sessionId],
  )

  return {
    health,
    ioRuntime,
    workspace,
    setWorkspace,
    journal,
    setJournal,
    pending,
    setPending,
    connectionStates,
    setConnectionStates,
    workspaceRef,
    inflight,
    flagInflight,
  }
}
