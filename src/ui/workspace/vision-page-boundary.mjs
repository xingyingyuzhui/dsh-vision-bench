import { clearActiveScope, sessionCwd, setActiveScope } from '../common/session-scope.mjs'

export function wrapVisionPage(React, Page, pageId) {
  return function VisionPageBoundary(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const tokenRef = React.useRef('')
    React.useEffect(() => {
      tokenRef.current = setActiveScope(`ws-${String(pageId)}-${Math.random().toString(36).slice(2, 8)}`, cwd)
      return () => {
        if (tokenRef.current) clearActiveScope(tokenRef.current)
      }
    }, [cwd, pageId])
    return el(Page, props)
  }
}
