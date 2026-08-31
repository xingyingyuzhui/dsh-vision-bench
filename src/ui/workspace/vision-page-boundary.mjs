import { clearActiveScope, pageSessionId, sessionCwd, setActiveScope } from '../common/session-scope.mjs'
import { navigate } from './vision-navigation-store.mjs'
import { VIEW_DEBUG, VIEW_HMI, VIEW_MONITOR } from './vision-route.mjs'

const PAGE_TO_VIEW = {
  debug: VIEW_DEBUG,
  hmi: VIEW_HMI,
  monitor: VIEW_MONITOR,
  [VIEW_DEBUG]: VIEW_DEBUG,
  [VIEW_HMI]: VIEW_HMI,
  [VIEW_MONITOR]: VIEW_MONITOR,
}

export function viewIdForPage(pageId) {
  return PAGE_TO_VIEW[String(pageId || '')] || ''
}

export function wrapVisionPage(React, Page, pageId) {
  return function VisionPageBoundary(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const viewId = viewIdForPage(pageId)
    const tokenRef = React.useRef('')
    React.useEffect(() => {
      tokenRef.current = setActiveScope(`ws-${String(pageId)}-${Math.random().toString(36).slice(2, 8)}`, {
        sessionId,
        cwd,
        viewId,
      })
      if (cwd && viewId) navigate(sessionId, cwd, { viewId, section: '', target: {} }, { source: 'init' })
      return () => {
        if (tokenRef.current) clearActiveScope(tokenRef.current)
      }
    }, [cwd, sessionId, viewId, pageId])
    return el(Page, props)
  }
}
