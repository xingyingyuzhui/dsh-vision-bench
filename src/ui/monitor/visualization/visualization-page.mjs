import { normalizeModbus } from '../../../../bench-devices.mjs'
// TaskP2/0.20.0: 侧边栏「可视化」— 以组件为中心（line/bar/value/switch）。
// 组件编辑器：名称/类型/关联点位搜索（仅 monitorEnabled，限定路径）。
// 渲染来源：line → modbus.trend（uPlot / ECharts）；bar → 最新 values；
// value → 数值卡；switch → FC01 写点（确认后写入并读回）。
import {
  buildAgentRef,
  buildInputBridge,
  dispatchAgentRef,
  evidenceFromRef,
  hasHarnessInput,
  postEvidence,
  readInputDraft,
  subscribeFocus,
  subscribeState,
} from '../../../../bench-shared.mjs'
import { TREND_WINDOW_MS } from '../../../../bench-trend.mjs'
import {
  VIZ_GRID_COLUMNS,
  formatSwitchWriteNote,
  monitoredPointOptions,
  normalizeVisualizationComponent,
  validateVisualizationComponent,
} from '../../../../bench-visualization-model.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createVizGrid } from '../../components/viz-grid.mjs'
import { createVizCard } from './components/viz-card.mjs'
import { createVizEditorPanel } from './components/viz-editor-panel.mjs'
import { createVizEmptyState } from './components/viz-empty-state.mjs'
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

    React.useEffect(() => {
      const timer = setInterval(() => setTick((n) => n + 1), 1000)
      return () => clearInterval(timer)
    }, [])

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

    function rejectIfReadOnly() {
      if (!vizReadOnlyRef.current) return false
      setNote(vizReadOnlyReasonRef.current || '当前为只读模式')
      return true
    }

    function editorValidation(ed) {
      const cur = ed || editor
      if (!cur) return { ok: false, reason: '' }
      if (!String(cur.name || '').trim()) return { ok: false, reason: '请填写组件名称' }
      const cand = normalizeVisualizationComponent({ ...cur, id: cur.id || '' })
      const v = validateVisualizationComponent(cand, points)
      if (!v.ok) return { ok: false, reason: v.error || '配置无效' }
      return { ok: true, reason: '', cand }
    }

    function persistViz(op, component, visualizationId = '') {
      if (rejectIfReadOnly()) return Promise.resolve(false)
      return post('/dsh-vision-bench/command', {
        cwd,
        sessionId: props?.sessionId || '',
        source: 'user',
        action: 'visualization',
        payload: {
          action: 'visualization',
          op,
          visualizationId,
          component,
          expectedConfigVersion: pack.configVersion || 1,
        },
      })
        .then((data) => {
          if (data && data.ok === false) {
            setNote(data.errorCode === 'CONFIG_DRIFT' ? '配置已被其他操作更新，请刷新后重试' : data.error || '保存失败')
            return false
          }
          if (data?.workspace?.modbus) setMb(data.workspace.modbus)
          return true
        })
        .catch((err) => {
          setNote(String(err?.message || '保存失败'))
          return false
        })
    }

    function saveComponent() {
      if (rejectIfReadOnly()) return
      if (!editor || saving) return
      const check = editorValidation()
      if (!check.ok) {
        setNote(check.reason)
        return
      }
      const existingIndex = editor.id ? components.findIndex((c) => c.id === editor.id) : -1
      const base = existingIndex >= 0 ? components[existingIndex] : {}
      const cand = normalizeVisualizationComponent({ ...base, ...editor, id: existingIndex >= 0 ? base.id : '' })
      setSaving(true)
      persistViz(existingIndex >= 0 ? 'update' : 'add', cand, existingIndex >= 0 ? base.id : '')
        .then((ok) => {
          setSaving(false)
          if (ok) {
            if (existingIndex >= 0 && base.type === 'line' && cand.type !== 'line') destroyChart(base.id)
            setEditor(null)
            setNote('')
          }
        })
        .catch(() => setSaving(false))
    }

    function removeComponent(id) {
      if (rejectIfReadOnly()) return
      persistViz('remove', {}, id).then((ok) => {
        if (ok) destroyChart(id)
      })
      setDeleteId('')
    }

    function openEditor(comp) {
      if (rejectIfReadOnly()) return
      if (canvasEditing) {
        flushLayout()
        setCanvasEditing(false)
      }
      setNote('')
      if (comp) setEditor({ ...comp, pointIds: (comp.pointIds || []).slice(), search: '' })
      else
        setEditor({
          id: '',
          name: `组件${components.length + 1}`,
          type: 'line',
          pointIds: [],
          order: components.length,
          settings: { windowMs: 300000, confirmWrite: true, yMin: '', yMax: '' },
          search: '',
        })
    }

    function toggleSwitch(comp, point, wantOn) {
      if (rejectIfReadOnly()) return
      if (!cwd || switchDraft.current?.busy) return
      const settings = comp.settings || {}
      const desiredValue = wantOn ? 1 : 0
      const now = Date.now()
      const pending = switchDraft.current
      const same =
        pending &&
        pending.componentId === comp.id &&
        pending.pointId === point.pointId &&
        pending.desiredValue === desiredValue &&
        pending.expiresAt > now
      if (settings.confirmWrite !== false && !same) {
        switchDraft.current = {
          componentId: comp.id,
          pointId: point.pointId,
          desiredValue,
          expiresAt: now + 10000,
          busy: false,
        }
        setNote(`再次点击「${wantOn ? '开' : '关'}」确认写入（10 秒内有效）`)
        setTick((n) => n + 1)
        return
      }
      switchDraft.current = {
        componentId: comp.id,
        pointId: point.pointId,
        desiredValue,
        expiresAt: now + 10000,
        busy: true,
      }
      setTick((n) => n + 1)
      post('/dsh-vision-bench/modbus/write', {
        cwd,
        source: 'user',
        sessionId: props?.sessionId || '',
        connectionId: point.connectionId,
        deviceId: point.deviceId,
        pointId: point.pointId,
        function: 1,
        address: point.address,
        values: [desiredValue],
      })
        .then((data) => {
          setNote(formatSwitchWriteNote(data, wantOn))
          return post('/dsh-vision-bench/state', { cwd, sessionId: props?.sessionId || undefined })
        })
        .then((data) => {
          if (data?.workspace) setMb(data.workspace.modbus)
        })
        .catch((err) => setNote(String(err?.message || '写入失败')))
        .finally(() => {
          switchDraft.current = null
          setTick((n) => n + 1)
        })
    }

    function copyComponentRef(comp) {
      const token = ++copyToken.current
      if (copyClearTimer.current) {
        clearTimeout(copyClearTimer.current)
        copyClearTimer.current = 0
      }
      const ref = buildAgentRef(
        'visualization',
        { visualizationId: comp.id, type: comp.type, pointIds: comp.pointIds, name: comp.name },
        { configVersion: pack?.configVersion || 1, start: Date.now() - TREND_WINDOW_MS, end: Date.now() },
      )
      const setDone = (msg) => {
        setCopied(msg)
        copyClearTimer.current = setTimeout(() => {
          copyClearTimer.current = 0
          if (aliveRef.current && token === copyToken.current) setCopied('')
        }, 2500)
      }
      dispatchAgentRef(ref, agentBridge)
        .then((res) => {
          if (!aliveRef.current || token !== copyToken.current) return
          if (!res || !res.ok) return setDone('复制失败')
          setDone(`${res.mode === 'input' ? '已加入输入框' : res.mode === 'sent' ? '已发送' : '已复制组件引用'} · ${comp.name}`)
        })
        .catch(() => {
          if (aliveRef.current && token === copyToken.current) setDone('复制失败')
        })
      try {
        postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
          if (aliveRef.current) setNote(reason)
        })
      } catch {}
    }

    const editorCheck = editorValidation()

    return el(
      'div',
      { className: 'dvb-live dvb-viz' },
      el(
        'div',
        { className: 'dvb-live-head dvb-viz-page-head' },
        el(
          'div',
          { className: 'dvb-viz-page-title-block' },
          el('span', { className: 'dvb-live-title' }, t('liveChart') || '可视化'),
          el(
            'div',
            { style: { display: 'flex', alignItems: 'center', gap: '8px' } },
            el('span', { className: 'dvb-map-meta' }, `${components.length} 个组件`),
            canvasEditing ? el('span', { className: 'dvb-viz-edit-badge' }, '画布编辑中') : null,
          ),
        ),
        !editor
          ? el(
              'div',
              { className: 'dvb-viz-page-actions' },
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
