import { emptyJournal, emptyWorkspace, pickJournal } from '../common/ui-format.mjs'
import { subscribeState } from '../common/state-subscription.mjs'

/**
 * Health, workspace, journal subscription and Keil persist helpers for Debug view.
 * OpenOCD binding updates are forwarded via `onOpenocdBinding` so flash state stays separate.
 *
 * @param {any} React
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 * @param {string} cwd
 * @param {string} sessionId
 * @param {{ onOpenocdBinding?: (opts: { path: string, bound: boolean, exists: boolean, force: boolean }) => void }} [opts]
 */
export function useDebugWorkspaceState(React, post, cwd, sessionId, opts) {
  const onOpenocdBinding = opts?.onOpenocdBinding
  const onOpenocdBindingRef = React.useRef(onOpenocdBinding)
  onOpenocdBindingRef.current = onOpenocdBinding

  const [health, setHealth] = React.useState({})
  const [workspace, setWorkspace] = React.useState(emptyWorkspace)
  const [journal, setJournal] = React.useState(emptyJournal)
  const [, setPendingWrites] = React.useState([])
  const workspaceRef = React.useRef(workspace)
  workspaceRef.current = workspace

  React.useEffect(() => {
    const stop = subscribeState(
      post,
      cwd,
      (data) => {
        if (!data) return
        if (data.health) setHealth(data.health)
        const boundPath = data.bindings?.openocd ? String(data.bindings.openocd) : ''
        const bound = !!data.health?.openocd?.bound
        const exists = !!data.health?.openocd?.exists
        const notify = onOpenocdBindingRef.current
        if (typeof notify === 'function') notify({ path: boundPath, bound, exists, force: false })
        if (Array.isArray(data.pendingWrites)) setPendingWrites(data.pendingWrites)
        if (data.workspace) {
          setWorkspace((prev) => ({
            ...prev,
            keil: { ...prev.keil, ...(data.workspace.keil || {}) },
            session: data.workspace.session || prev.session,
            manualRequests: Array.isArray(data.workspace.manualRequests)
              ? data.workspace.manualRequests
              : prev.manualRequests,
            modbus: data.workspace.modbus || prev.modbus,
          }))
        }
        setJournal(pickJournal(data))
      },
      { sessionId },
    )
    return () => {
      if (typeof stop === 'function') stop()
    }
  }, [cwd, post, sessionId])

  function setKeil(patch) {
    setWorkspace((prev) => ({ ...prev, keil: { ...prev.keil, ...patch } }))
  }

  function resolveManual(id, done) {
    if (!cwd) return
    post('/dsh-vision-bench/manual/resolve', { cwd, id, done }, 15000)
      .then(() => {
        setWorkspace((prev) => ({
          ...prev,
          manualRequests: (prev.manualRequests || []).map((item) =>
            item.id === id ? { ...item, status: done ? 'done' : 'rejected' } : item,
          ),
        }))
        return post('/dsh-vision-bench/state', { cwd })
      })
      .then((data) => {
        if (data?.workspace) {
          setWorkspace((prev) => ({ ...prev, manualRequests: data.workspace.manualRequests || prev.manualRequests }))
        }
        if (data) setJournal(pickJournal(data))
      })
      .catch(() => {})
  }

  function mergeState(data) {
    if (data?.workspace) {
      setWorkspace((prev) => ({
        ...prev,
        keil: { ...prev.keil, ...(data.workspace.keil || {}) },
        session: data.workspace.session || prev.session,
      }))
    }
    if (data) setJournal(pickJournal(data))
    return data
  }

  function persist(next) {
    if (!cwd) return Promise.resolve()
    const keil = next?.keil || workspace.keil
    return post('/dsh-vision-bench/workspace', {
      cwd,
      keil: { project: keil.project || '', target: keil.target || '', artifact: keil.artifact || 'hex' },
    }).then((data) => {
      if (data?.workspace) {
        setWorkspace((prev) => ({ ...prev, keil: data.workspace.keil, modbus: data.workspace.modbus || prev.modbus }))
      }
      if (data) setJournal(pickJournal(data))
    })
  }

  return {
    health,
    workspace,
    setWorkspace,
    journal,
    setJournal,
    setKeil,
    resolveManual,
    mergeState,
    persist,
    workspaceRef,
  }
}
