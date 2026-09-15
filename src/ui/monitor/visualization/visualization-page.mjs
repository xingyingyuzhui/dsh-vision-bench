import { normalizeModbus } from '../../../application/modbus/modbus-migration.mjs'
// TaskP2/0.20.0: 侧边栏「可视化」— 以组件为中心（line/bar/value/switch）。
// 组件编辑器：名称/类型/关联点位搜索（仅 monitorEnabled，限定路径）。
// 渲染来源：line → modbus.trend（uPlot / ECharts）；bar → 最新 values；
// value → 数值卡；switch → FC01 写点（确认后写入并读回）。
import { buildInputBridge, hasHarnessInput, readInputDraft } from '../../common/agent-reference.mjs'
import { subscribeFocus } from '../../common/focus-store.mjs'
import { subscribeState } from '../../common/state-subscription.mjs'
import { VIZ_GRID_COLUMNS, monitoredPointOptions } from '../../../domain/modbus/visualization-model.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createVizGrid } from '../../components/viz-grid.mjs'
import { createVizCard } from './components/viz-card.mjs'
import { createVizEditorPanel } from './components/viz-editor-panel.mjs'
import { createVizEmptyState } from './components/viz-empty-state.mjs'
import { useVizActions } from './hooks/use-viz-actions.mjs'
import { useVizCharts } from './hooks/use-viz-charts.mjs'
import { useVizLayout } from './hooks/use-viz-layout.mjs'

export function createVisualizationPage(React, t, post, hooks) {
  const openHmi = hooks?.openHmi
  void openHmi
  const el = React.createElement
  const VizGrid = createVizGrid(React)
  const VizCard = createVizCard(React, t)
  const VizEditorPanel = createVizEditorPanel(React, t)
  const VizEmptyState = createVizEmptyState(React, t)

  return function VisualizationPage(props) {
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)

    const [mb, setMb] = React.useState(null)
    const [editor, setEditor] = React.useState(null)
    const [deleteId, setDeleteId] = React.useState('')
    const [canvasEditing, setCanvasEditing] = React.useState(false)
    const [copied, setCopied] = React.useState('')
    const [note, setNote] = React.useState('')
    const [focusVizId, setFocusVizId] = React.useState('')
    const [saving, setSaving] = React.useState(false)
    const [, setTick] = React.useState(0)

    const aliveRef = React.useRef(true)
    const copyClearTimer = React.useRef(0)
    const packRef = React.useRef(null)
    const switchDraft = React.useRef(null)
    const copyToken = React.useRef(0)
    const vizReadOnlyRef = React.useRef(false)
    const vizReadOnlyReasonRef = React.useRef('')

    React.useEffect(() => {
      aliveRef.current = true
      return () => {
        aliveRef.current = false
        if (copyClearTimer.current) {
          clearTimeout(copyClearTimer.current)
          copyClearTimer.current = 0
        }
      }
    }, [])

    React.useEffect(() => {
      setMb(null)
      setEditor(null)
      setDeleteId('')
      setFocusVizId('')
      setCanvasEditing(false)
    }, [cwd, sessionId])

    React.useEffect(() => {
      setFocusVizId('')
      return subscribeFocus(cwd, (fs) => {
        try {
          setFocusVizId(fs?.request?.visualizationId || '')
        } catch {}
      })
    }, [cwd])

    React.useEffect(() => {
      if (!cwd || !post) return undefined
      let stop = false
      const sid = sessionId || ''
      post('/dsh-vision-bench/state', { cwd, sessionId: sid || undefined })
        .then((data) => {
          if (!stop && data) setMb(data.workspace?.modbus || null)
        })
        .catch(() => {})
      const unsub = subscribeState(
        post,
        cwd,
        (data) => {
          if (stop || !data) return
          const next = data.workspace?.modbus
          if (next) setMb(next)
        },
        { sessionId: sid },
      )
      return () => {
        stop = true
        if (typeof unsub === 'function') unsub()
      }
    }, [cwd, post, sessionId])

    // Charts refresh from subscribeState. Do not tick the whole GridStack/ECharts
    // tree at 1 Hz — that keeps the renderer and GPU awake even with no new samples.

    const pack = (() => {
      try {
        return normalizeModbus(mb || {})
      } catch {
        return null
      }
    })()
    packRef.current = pack

    const points = pack ? pack.points || [] : []
    const viz = pack
      ? pack.visualization || { schemaVersion: 2, columns: VIZ_GRID_COLUMNS, components: [] }
      : { schemaVersion: 2, columns: VIZ_GRID_COLUMNS, components: [] }
    const vizReadOnly = viz?.unsupported === true
    const vizReadOnlyReason = vizReadOnly ? viz.error || '当前可视化配置由更高版本插件创建，只能查看' : ''
    vizReadOnlyRef.current = vizReadOnly
    vizReadOnlyReasonRef.current = vizReadOnlyReason

    const components = viz && Array.isArray(viz.components) ? viz.components : []
    const values = pack ? pack.values || [] : []
    const trendStore = pack ? pack.trend || {} : {}
    const pointOptions = pack ? monitoredPointOptions(pack) : []

    const { layoutOf, persistLayout, flushLayout, resetLayout } = useVizLayout(React, {
      cwd,
      sessionId,
      post,
      packRef,
      setMb,
      setNote,
      vizReadOnlyRef,
      aliveRef,
    })

    const { chartErrors, setChartErrors, destroyChart, seriesOfComponent, ensureChart, ensureBarChart } = useVizCharts(
      React,
      { components, points, trendStore },
    )

    const { editorValidation, saveComponent, removeComponent, openEditor, toggleSwitch, copyComponentRef } = useVizActions(
      React,
      {
        cwd,
        post,
        props,
        agentBridge,
        pack,
        components,
        points,
        editor,
        setEditor,
        setDeleteId,
        setCanvasEditing,
        setCopied,
        setNote,
        setMb,
        setSaving,
        setTick,
        saving,
        canvasEditing,
        aliveRef,
        copyClearTimer,
        copyToken,
        switchDraft,
        vizReadOnlyRef,
        vizReadOnlyReasonRef,
        flushLayout,
        destroyChart,
      },
    )

    React.useEffect(() => {
      if (!vizReadOnly) return
      setEditor(null)
      setDeleteId('')
      setCanvasEditing(false)
      switchDraft.current = null
      resetLayout()
    }, [vizReadOnly, resetLayout])

    React.useEffect(() => {
      if (!components.length && canvasEditing) setCanvasEditing(false)
    }, [components.length, canvasEditing])

    const editorCheck = editorValidation()

    return el(
      'div',
      { className: 'dvb-live dvb-viz' },
      el(
        'div',
        { className: 'dvb-live-head dvb-viz-page-head', style: { padding: 0, margin: 0 } },
        canvasEditing ? el('span', { className: 'dvb-pill dvb-pill-warn dvb-viz-edit-badge' }, '画布编辑中') : null,
        !editor
          ? el(
              'div',
              { className: 'dvb-viz-page-actions', style: { marginLeft: 'auto', display: 'flex', gap: '8px', alignItems: 'center' } },
              components.length > 0 && !vizReadOnly
                ? el(
                    'button',
                    {
                      type: 'button',
                      className: canvasEditing ? 'dvb-btn dvb-btn-primary' : 'dvb-btn',
                      onClick() {
                        if (canvasEditing) {
                          flushLayout()
                          setCanvasEditing(false)
                        } else {
                          setCanvasEditing(true)
                        }
                      },
                    },
                    canvasEditing ? '完成编辑' : '编辑画布',
                  )
                : null,
              el(
                'button',
                {
                  type: 'button',
                  className: canvasEditing ? 'dvb-btn' : 'dvb-btn dvb-btn-primary',
                  disabled: !cwd || vizReadOnly,
                  title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                  onClick() {
                    openEditor(null)
                  },
                },
                t('vizNew') || '新建组件',
              ),
            )
          : null,
      ),
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      note ? el('div', { className: 'dvb-hint' }, note) : null,
      vizReadOnly
        ? el(
            'div',
            {
              className: 'dvb-panel dvb-viz-readonly',
              role: 'status',
              'aria-live': 'polite',
            },
            el('div', { className: 'dvb-viz-readonly-title' }, t('vizReadOnlyTitle')),
            vizReadOnlyReason ? el('div', { className: 'dvb-hint' }, vizReadOnlyReason) : null,
            el('div', { className: 'dvb-hint' }, t('vizReadOnlyHint')),
          )
        : null,
      el(
        VizGrid,
        {
          columns: viz.columns || VIZ_GRID_COLUMNS,
          items: components.map((c) => ({ id: c.id, ...layoutOf(c) })),
          readOnly: vizReadOnly,
          editing: canvasEditing,
          onLayout: vizReadOnly ? undefined : persistLayout,
        },
        components.map((comp) => {
          const lay = layoutOf(comp)
          return el(
            'div',
            {
              key: comp.id,
              className: 'grid-stack-item',
              'gs-id': comp.id,
              'gs-x': String(lay.x),
              'gs-y': String(lay.y),
              'gs-w': String(lay.w),
              'gs-h': String(lay.h),
              style: {
                '--dvb-w': String(lay.w),
              },
            },
            el(
              'div',
              { className: 'grid-stack-item-content' },
              el(VizCard, {
                comp,
                points,
                values,
                chartErrors,
                deleteId,
                focusVizId,
                vizReadOnly,
                hasInputHarness: hasHarnessInput(props),
                switchDraft,
                cwd,
                onCopyRef: copyComponentRef,
                onOpenEditor: openEditor,
                onRequestDelete: (id) => setDeleteId(id),
                onConfirmDelete: removeComponent,
                onCancelDelete: () => setDeleteId(''),
                onToggleSwitch: toggleSwitch,
                ensureChart,
                ensureBarChart,
                destroyChart,
                seriesOfComponent,
                setChartErrors,
                setTick,
              }),
            ),
          )
        }),
      ),
      !components.length && !editor
        ? el(VizEmptyState, {
            cwd,
            pointOptions,
            vizReadOnly,
            onNewComponent() {
              openEditor(null)
            },
          })
        : null,
      el(VizEditorPanel, {
        editor,
        setEditor,
        points,
        devices: pack ? pack.devices || [] : [],
        connections: pack ? pack.connections || [] : [],
        pointOptions,
        editorCheck,
        saving,
        vizReadOnly,
        onSave: saveComponent,
        onCancel() {
          setEditor(null)
        },
      }),
    )
  }
}
