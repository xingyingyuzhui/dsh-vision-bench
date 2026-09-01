import { clearActiveScope, pageSessionId, sessionCwd, setActiveScope } from '../common/session-scope.mjs'
import { isManualNavLeaseActive, navigate } from './vision-navigation-store.mjs'
import { VIEW_DEBUG, VIEW_HMI, VIEW_MONITOR } from './vision-route.mjs'
import {
  acceptQueuedVisionRequest,
  applyConsumedViewRequest,
  consumeViewRequest,
  peekVisionRequest,
  shouldHandleViewRequest,
  subscribeVisionQueue,
} from './vision-view-request.mjs'

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

export function wrapVisionPage(React, Page, pageId, t) {
  const waitingTitle = typeof t === 'function' ? t('workspaceWaiting') : '正在等待工作区'
  const waitingHint =
    typeof t === 'function' ? t('workspaceWaitingHint') : '当前 Session 尚未加入工作区，加入后会自动加载状态。'
  return function VisionPageBoundary(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const viewId = viewIdForPage(pageId)
    const tokenRef = React.useRef('')
    const handledRef = React.useRef('')
    const [, setQueueTick] = React.useState(0)
    React.useEffect(() => {
      tokenRef.current = setActiveScope(`ws-${String(pageId)}-${Math.random().toString(36).slice(2, 8)}`, {
        sessionId,
        cwd,
        viewId,
        openView: props.openView,
      })
      if (cwd && viewId) navigate(sessionId, cwd, { viewId, section: '', target: {} }, { source: 'init' })
      return () => {
        if (tokenRef.current) clearActiveScope(tokenRef.current)
      }
    }, [cwd, sessionId, viewId, pageId, props.openView])
    React.useEffect(() => subscribeVisionQueue(() => setQueueTick((n) => n + 1)), [])
    React.useEffect(() => {
      const req = props.viewRequest
      const decision = consumeViewRequest(req, viewId)
      if (!decision.complete && !decision.consume) return undefined
      const key = `${sessionId}\0${req?.view || ''}\0${String(req?.focus || '')}`
      if (!shouldHandleViewRequest(handledRef, key)) return undefined
      if (decision.consume && cwd) applyConsumedViewRequest(sessionId, cwd, viewId, decision.payload)
      if (decision.complete && typeof props.completeViewRequest === 'function') props.completeViewRequest()
      return undefined
    }, [props.viewRequest, viewId, sessionId, cwd, props.completeViewRequest])
    const queued = peekVisionRequest(sessionId)
    const showGo = !!queued && (queued.viewId !== viewId || (cwd && isManualNavLeaseActive(sessionId, cwd)))
    const goLabel = typeof t === 'function' ? t('goAgentTarget') : '前往 Agent 目标'
    if (!cwd) {
      return el(
        'div',
        { className: 'dvb-page', role: 'status', 'data-workspace-waiting': 'true' },
        el('div', { className: 'dvb-hint' }, waitingTitle),
        el('div', { className: 'dvb-hint' }, waitingHint),
      )
    }
    const page = el(Page, props)
    if (!showGo) return page
    return el(
      'div',
      { className: 'dvb-page-wrap' },
      el(
        'div',
        { className: 'dvb-hint', 'data-agent-nav-pending': 'true' },
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm',
            onClick() {
              acceptQueuedVisionRequest(props)
            },
          },
          goLabel,
        ),
      ),
      page,
    )
  }
}
