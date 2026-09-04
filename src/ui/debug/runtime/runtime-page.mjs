// @ts-check

import { postWithAbort } from '../../common/latest-request-gate.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createSourceEditor } from '../../components/source-editor.mjs'
import { languageForPath } from '../project/project-tree-model.mjs'
import { createBreakpointPanel } from './breakpoint-panel.mjs'
import { createDebugApprovalCard } from './debug-approval-card.mjs'
import { createDebugTimelinePanel } from './debug-timeline-panel.mjs'
import { createDebugToolbar } from './debug-toolbar.mjs'
import { createStackPanel } from './stack-panel.mjs'
import { useDebugEvents } from './use-debug-events.mjs'
import { createVariablesPanel } from './variables-panel.mjs'

/**
 * Creates the Browser Runtime Debug UI page.
 * Parity with Phase 7 Section 11.2 - 11.10.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 */
export function createRuntimePage(React, t, post) {
  const el = React.createElement
  const SourceEditor = createSourceEditor(React)
  const DebugToolbar = createDebugToolbar(React, t)
  const DebugApprovalCard = createDebugApprovalCard(React, t)
  const StackPanel = createStackPanel(React, t)
  const VariablesPanel = createVariablesPanel(React, t)
  const BreakpointPanel = createBreakpointPanel(React, t)
  const DebugTimelinePanel = createDebugTimelinePanel(React, t)

  return function RuntimePage(props) {
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)

    const debug = useDebugEvents(React, post, { cwd, sessionId })
    const { actions } = debug

    const [sourcePreview, setSourcePreview] = React.useState({
      rel: '',
      text: '',
      jumpLine: 0,
      loading: false,
      error: null,
    })

    const fileAbortRef = React.useRef(null)

    // Load file content for source editor preview
    const loadSource = React.useCallback(
      async (filePath, line = 0) => {
        if (!filePath || !cwd) return
        if (fileAbortRef.current) {
          fileAbortRef.current.abort()
        }
        const ac = new AbortController()
        fileAbortRef.current = ac

        setSourcePreview((prev) => ({
          ...prev,
          rel: filePath,
          jumpLine: line,
          loading: true,
          error: null,
        }))

        try {
          const res = await postWithAbort(post, '/dsh-vision-bench/project/file', { cwd, path: filePath }, ac.signal)
          if (ac.signal.aborted) return
          if (res?.ok) {
            setSourcePreview({
              rel: res.rel || filePath,
              text: res.text || '',
              jumpLine: line,
              loading: false,
              error: null,
            })
          } else {
            setSourcePreview((prev) => ({
              ...prev,
              loading: false,
              error: res?.error || '无法读取源文件',
            }))
          }
        } catch (err) {
          if (ac.signal.aborted) return
          setSourcePreview((prev) => ({
            ...prev,
            loading: false,
            error: err instanceof Error ? err.message : String(err),
          }))
        }
      },
      [cwd, post],
    )

    // Automatically follow paused location
    React.useEffect(() => {
      const loc = debug.session?.location
      if (loc && loc.file) {
        loadSource(loc.file, loc.line || 0)
      }
    }, [debug.session?.location, loadSource])

    // Clean up file fetch on unmount
    React.useEffect(() => {
      return () => {
        if (fileAbortRef.current) fileAbortRef.current.abort()
      }
    }, [])

    const handleSelectFrame = (level, frame) => {
      actions.selectFrame(level)
      if (frame?.file) {
        loadSource(frame.file, frame.line || 0)
      }
    }

    const sessionData = debug.session
    const breakpoints = sessionData?.breakpoints
      ? Array.isArray(sessionData.breakpoints)
        ? sessionData.breakpoints
        : Object.values(sessionData.breakpoints)
      : []
    const watchpoints = sessionData?.watchpoints
      ? Array.isArray(sessionData.watchpoints)
        ? sessionData.watchpoints
        : Object.values(sessionData.watchpoints)
      : []

    return el(
      'div',
      { className: 'dvb-debug-runtime', 'data-debug-status': debug.status },
      // 1. Toolbar
      el(DebugToolbar, {
        status: debug.status,
        backend: sessionData?.backend || sessionData?.backendKind || 'gdb-openocd',
        target: sessionData?.targetKey || sessionData?.target || '',
        location: sessionData?.location || null,
        loading: debug.loading,
        onStart: () => actions.startDebug(),
        onStop: () => actions.stopDebug(),
        onRun: () => actions.run(),
        onPause: () => actions.pause(),
        onStep: (type) => actions.step(type),
        onReset: () => actions.reset(),
        onRefresh: () => actions.refresh(),
      }),

      // 2. Pending Approvals Card (if any)
      debug.pendingApprovals.length > 0
        ? el(DebugApprovalCard, {
            tickets: debug.pendingApprovals,
            onApprove: (id) => actions.approve(id),
            onReject: (id) => actions.reject(id),
          })
        : null,

      // Global Error callout if any
      debug.error
        ? el(
            'div',
            {
              className: 'dvb-callout',
              style: {
                borderColor: 'var(--dsw-alias-label-danger, #c62828)',
                color: 'var(--dsw-alias-label-danger, #c62828)',
                fontSize: '11px',
              },
            },
            `⚠️ ${debug.error}`,
          )
        : null,

      // 3. Main Grid (Split 35% left / 65% right)
      el(
        'div',
        { className: 'dvb-debug-grid' },
        // Left Column: Call Stack + Breakpoints/Watchpoints
        el(
          'div',
          { className: 'dvb-debug-col-left' },
          el(StackPanel, {
            stack: sessionData?.stack || [],
            selectedFrame: debug.selectedFrame,
            onSelectFrame: handleSelectFrame,
          }),
          el(BreakpointPanel, {
            breakpoints,
            watchpoints,
            onAddBreakpoint: (bp) => actions.addBreakpoint(bp),
            onRemoveBreakpoint: (id) => actions.removeBreakpoint(id),
            onAddWatchpoint: (wp) => actions.addWatchpoint(wp),
            onRemoveWatchpoint: (id) => actions.removeWatchpoint(id),
            error: debug.error,
          }),
        ),

        // Right Column: Source Editor Preview + Variables/Watches/Registers
        el(
          'div',
          { className: 'dvb-debug-col-right' },
          // Source preview panel
          el(
            'div',
            { className: 'dvb-debug-panel', style: { flex: 1.2 } },
            el(
              'div',
              { className: 'dvb-debug-panel-head' },
              el(
                'span',
                null,
                sourcePreview.rel
                  ? `源码 · ${sourcePreview.rel.split(/[\\/]/).pop()}${sourcePreview.jumpLine ? ` : ${sourcePreview.jumpLine}` : ''}`
                  : '源码视图 (Source)',
              ),
              sourcePreview.loading ? el('span', { className: 'dvb-hint' }, '加载中…') : null,
            ),
            el(
              'div',
              { className: 'dvb-debug-panel-body', style: { padding: 0 } },
              sourcePreview.error
                ? el(
                    'div',
                    { className: 'dvb-hint', style: { padding: '16px', textAlign: 'center' } },
                    sourcePreview.error,
                  )
                : sourcePreview.rel
                  ? el(SourceEditor, {
                      text: sourcePreview.text,
                      rel: sourcePreview.rel,
                      jumpLine: sourcePreview.jumpLine,
                      language: languageForPath(sourcePreview.rel),
                    })
                  : el(
                      'div',
                      { className: 'dvb-hint', style: { padding: '24px', textAlign: 'center' } },
                      '调试器暂停或选择调用栈帧时，将在此处高亮显示当前执行代码行。',
                    ),
            ),
          ),

          // Variables & Watches panel
          el(
            'div',
            { style: { flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' } },
            el(VariablesPanel, {
              locals: debug.variables.locals || [],
              watches: debug.watches,
              watchValues: debug.watchValues,
              registers: debug.variables.registers || [],
              onAddWatch: (expr) => actions.addWatch(expr),
              onRemoveWatch: (expr) => actions.removeWatch(expr),
              onRefresh: () => actions.refresh(),
            }),
          ),
        ),
      ),

      // 4. Debug Timeline panel (bottom)
      el(DebugTimelinePanel, {
        events: debug.events,
      }),
    )
  }
}
