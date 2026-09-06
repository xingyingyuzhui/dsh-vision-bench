import { normalizeModbus } from '../../../../bench-devices.mjs'
// TaskP2/0.20.0: 侧边栏「可视化」— 以组件为中心（line/bar/value/switch）。
// 组件编辑器：名称/类型/关联点位搜索（仅 monitorEnabled，限定路径）。
// 渲染来源：line → modbus.trend（uPlot）；bar → 最新 values（CSS 条形，非 uPlot bars）；
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
import {
  TREND_WINDOW_MS,
  UPLOT_PROTO,
  componentLatestValues,
  trendDataForComponents,
} from '../../../../bench-trend.mjs'
import { vendorUPlot } from '../../../../bench-vendor.mjs'
import {
  COMPONENT_TYPES,
  VIZ_GRID_COLUMNS,
  formatSwitchWriteNote,
  monitoredPointOptions,
  normalizeVisualizationComponent,
  validateVisualizationComponent,
  visualizationComponentStatus,
} from '../../../../bench-visualization-model.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { getCustomSelect } from '../../components/custom-select.mjs'
import { createVizGrid } from '../../components/viz-grid.mjs'
import { getEcharts } from '../../vendor/echarts-runtime.mjs'
import { renderBarRenderer } from './renderers/bar-renderer.mjs'
import { renderLineRenderer } from './renderers/line-renderer.mjs'
import { renderSwitchRenderer } from './renderers/switch-renderer.mjs'
import { renderValueRenderer } from './renderers/value-renderer.mjs'
import {
  VIZ_COLORS,
  echartsBarFromLatest,
  echartsSeriesFromTrend,
  hasTrendSamples,
  pointCompatible,
  vizFieldOf,
  vizTypeLabel,
} from './viz-helpers.mjs'
export function createVisualizationPage(React, t, post, hooks) {
  const openHmi = hooks?.openHmi
  void openHmi
  const el = React.createElement
  const VizGrid = createVizGrid(React)
  const CustomSelect = getCustomSelect(React)
  return function VisualizationPage(props) {
    const cwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const [mb, setMb] = React.useState(null)
    const [editor, setEditor] = React.useState(null)
    const [deleteId, setDeleteId] = React.useState('')
    const [copied, setCopied] = React.useState('')
    const [note, setNote] = React.useState('')
    const [focusVizId, setFocusVizId] = React.useState('')
    const [chartErrors, setChartErrors] = React.useState({})
    const [saving, setSaving] = React.useState(false)
    const aliveRef = React.useRef(true)
    const copyClearTimer = React.useRef(0)
    const layoutTimer = React.useRef(0)
    const layoutInflight = React.useRef(false)
    const layoutQueued = React.useRef(false)
    React.useEffect(() => {
      aliveRef.current = true
      return () => {
        aliveRef.current = false
        if (copyClearTimer.current) {
          clearTimeout(copyClearTimer.current)
          copyClearTimer.current = 0
        }
        if (layoutTimer.current) {
          clearTimeout(layoutTimer.current)
          layoutTimer.current = 0
        }
      }
    }, [])
    React.useEffect(() => {
      setMb(null)
      setEditor(null)
      setDeleteId('')
      setFocusVizId('')
      setChartErrors({})
    }, [cwd, sessionId])
    React.useEffect(() => {
      setFocusVizId('')
      return subscribeFocus(cwd, (fs) => {
        try {
          setFocusVizId(fs?.request?.visualizationId || '')
        } catch {}
      })
    }, [cwd])
    const [, setTick] = React.useState(0)
    const uplotRefs = React.useRef({})
    const echartRefs = React.useRef({})
    const layoutDraft = React.useRef(null)
    const packRef = React.useRef(null)
    const switchDraft = React.useRef(null)
    const copyToken = React.useRef(0)
    const vizReadOnlyRef = React.useRef(false)
    const vizReadOnlyReasonRef = React.useRef('')

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

    const destroyChart = (id) => {
      const u = uplotRefs.current[id]
      if (u) {
        try {
          u.destroy()
        } catch {}
      }
      delete uplotRefs.current[id]
      const chart = echartRefs.current[id]
      if (chart) {
        try {
          chart.dispose()
        } catch {}
      }
      delete echartRefs.current[id]
    }

    React.useEffect(() => {
      const live = new Set()
      for (const comp of components) {
        if ((comp.type === 'line' || comp.type === 'bar') && visualizationComponentStatus(comp, points) === 'ok') {
          live.add(comp.id)
        }
      }
      for (const id of Object.keys(uplotRefs.current)) {
        if (!live.has(id)) destroyChart(id)
      }
      for (const id of Object.keys(echartRefs.current)) {
        if (!live.has(id)) destroyChart(id)
      }
    }, [components, points])

    React.useEffect(() => {
      if (!vizReadOnly) return
      setEditor(null)
      setDeleteId('')
      switchDraft.current = null
      layoutDraft.current = null
      layoutQueued.current = false
      if (layoutTimer.current) {
        clearTimeout(layoutTimer.current)
        layoutTimer.current = 0
      }
    }, [vizReadOnly])

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

    function persistLayout(items) {
      if (vizReadOnlyRef.current) return
      if (!cwd || !pack || !Array.isArray(items) || !items.length) return
      const draft = { ...(layoutDraft.current || {}) }
      for (const item of items) {
        if (!item || !item.id) continue
        draft[item.id] = { x: item.x, y: item.y, w: item.w, h: item.h }
      }
      layoutDraft.current = draft
      if (layoutTimer.current) clearTimeout(layoutTimer.current)
      layoutTimer.current = setTimeout(() => {
        layoutTimer.current = 0
        flushLayout()
      }, 300)
    }

    function flushLayout() {
      if (vizReadOnlyRef.current) {
        layoutDraft.current = null
        layoutQueued.current = false
        return
      }
      if (!aliveRef.current) return
      if (layoutInflight.current) {
        layoutQueued.current = true
        return
      }
      const draft = layoutDraft.current
      if (!draft || !Object.keys(draft).length) return
      const items = Object.keys(draft).map((id) => ({ id, ...draft[id] }))
      const sent = { ...draft }
      const version = packRef.current?.configVersion || 1
      layoutInflight.current = true
      post('/dsh-vision-bench/command', {
        cwd,
        sessionId: props?.sessionId || '',
        source: 'user',
        action: 'visualization',
        payload: {
          action: 'visualization',
          op: 'layout',
          items,
          expectedConfigVersion: version,
        },
      })
        .then((data) => {
          if (!aliveRef.current) return
          if (data && data.ok === false) {
            if (data.errorCode === 'CONFIG_DRIFT') {
              return post('/dsh-vision-bench/state', { cwd, sessionId: props?.sessionId || '' }).then((fresh) => {
                if (!aliveRef.current) return
                if (fresh?.workspace?.modbus) setMb(fresh.workspace.modbus)
                layoutQueued.current = true
              })
            }
            setNote(data.error || '布局保存失败')
            return
          }
          if (data?.workspace?.modbus) setMb(data.workspace.modbus)
          const cur = layoutDraft.current || {}
          const next = {}
          for (const id of Object.keys(cur)) {
            const a = cur[id]
            const b = sent[id]
            if (a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) continue
            next[id] = a
          }
          layoutDraft.current = Object.keys(next).length ? next : null
        })
        .catch((err) => {
          if (aliveRef.current) setNote(String(err?.message || '布局保存失败'))
        })
        .finally(() => {
          layoutInflight.current = false
          if (layoutQueued.current && aliveRef.current) {
            layoutQueued.current = false
            flushLayout()
          }
        })
    }

    function layoutOf(comp) {
      return layoutDraft.current?.[comp.id] || comp.layout || { x: 0, y: 0, w: 6, h: 4 }
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
      setNote('')
      if (comp) setEditor({ ...comp, pointIds: (comp.pointIds || []).slice(), search: '' })
      else
        setEditor({
          id: '',
          name: `组件${components.length + 1}`,
          type: 'line',
          pointIds: [],
          order: components.length,
          settings: { windowMs: 300000, confirmWrite: true },
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

    const seriesOfComponent = (comp) =>
      trendDataForComponents(trendStore, points, comp.pointIds, comp.settings?.windowMs || TREND_WINDOW_MS)

    const ensureUplot = (node, comp) => {
      if (!node) return
      const payload = seriesOfComponent(comp)
      const existing = uplotRefs.current[comp.id]
      if (existing && existing._node === node) {
        if (!hasTrendSamples(payload)) {
          destroyChart(comp.id)
          return
        }
        try {
          existing.setData(payload.data)
        } catch (err) {
          setChartErrors((prev) => ({ ...prev, [comp.id]: String(err?.message || err) }))
        }
        return
      }
      if (!hasTrendSamples(payload)) {
        destroyChart(comp.id)
        return
      }
      const UPlot = vendorUPlot()
      if (!UPlot) {
        setChartErrors((prev) => ({ ...prev, [comp.id]: '图表运行时不可用' }))
        return
      }
      try {
        if (existing) destroyChart(comp.id)
        const hostWin = typeof globalThis !== 'undefined' ? globalThis.window : undefined
        const isDark = !!hostWin?.matchMedia?.('(prefers-color-scheme: dark)').matches
        const opts = {
          ...UPLOT_PROTO,
          width: node.clientWidth || 420,
          height: 150,
          pxRatio: hostWin?.devicePixelRatio || 1,
          scales: { x: { time: true }, y: { auto: true } },
          axes: [
            {
              stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)',
              grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' },
            },
            {
              stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)',
              grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' },
            },
          ],
          series: [{ label: 'time' }].concat(
            payload.keys.map((k, i) => ({
              label: payload.meta[i]?.label || k,
              stroke: VIZ_COLORS[i % VIZ_COLORS.length],
              width: 1.5,
              spanGaps: false,
              points: { show: false },
            })),
          ),
        }
        const chart = new UPlot(opts, payload.data, node)
        chart._node = node
        uplotRefs.current[comp.id] = chart
        setChartErrors((prev) => {
          const next = { ...prev }
          delete next[comp.id]
          return next
        })
      } catch (err) {
        setChartErrors((prev) => ({ ...prev, [comp.id]: `曲线渲染失败: ${String(err?.message || err)}` }))
      }
    }

    const ensureChart = (node, comp) => {
      if (!node) return
      const echarts = getEcharts()
      if (!echarts) {
        ensureUplot(node, comp)
        return
      }
      const payload = seriesOfComponent(comp)
      if (!hasTrendSamples(payload)) {
        destroyChart(comp.id)
        return
      }
      try {
        if (uplotRefs.current[comp.id]) destroyChart(comp.id)
        let chart = echartRefs.current[comp.id]
        if (!chart || chart._node !== node) {
          if (chart) {
            try {
              chart.dispose()
            } catch {}
          }
          chart = echarts.init(node, null, { renderer: 'canvas' })
          chart._node = node
          echartRefs.current[comp.id] = chart
        }
        const hostWin = typeof globalThis !== 'undefined' ? globalThis.window : undefined
        const isDark = !!hostWin?.matchMedia?.('(prefers-color-scheme: dark)').matches
        chart.setOption(
          {
            animation: false,
            backgroundColor: 'transparent',
            color: VIZ_COLORS,
            textStyle: { color: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)' },
            tooltip: { trigger: 'axis' },
            legend: { type: 'scroll', top: 0 },
            grid: { left: 44, right: 16, top: 28, bottom: 24 },
            xAxis: {
              type: 'time',
              axisLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,.2)' : 'rgba(0,0,0,.2)' } },
            },
            yAxis: {
              type: 'value',
              splitLine: { lineStyle: { color: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' } },
            },
            series: echartsSeriesFromTrend(payload),
          },
          true,
        )
        chart.resize()
        setChartErrors((prev) => {
          const next = { ...prev }
          delete next[comp.id]
          return next
        })
      } catch (err) {
        setChartErrors((prev) => ({ ...prev, [comp.id]: `曲线渲染失败: ${String(err?.message || err)}` }))
      }
    }

    const ensureBarChart = (node, comp, latest) => {
      if (!node) return
      const echarts = getEcharts()
      if (!echarts) return
      try {
        let chart = echartRefs.current[comp.id]
        if (!chart || chart._node !== node) {
          if (chart) {
            try {
              chart.dispose()
            } catch {}
          }
          chart = echarts.init(node, null, { renderer: 'canvas' })
          chart._node = node
          echartRefs.current[comp.id] = chart
        }
        const packBar = echartsBarFromLatest(latest, VIZ_COLORS)
        chart.setOption(
          {
            animation: false,
            backgroundColor: 'transparent',
            tooltip: { trigger: 'axis' },
            grid: { left: 44, right: 16, top: 16, bottom: 32 },
            xAxis: { type: 'category', data: packBar.names },
            yAxis: { type: 'value' },
            series: [
              {
                type: 'bar',
                data: packBar.values.map((v, i) => ({
                  value: v,
                  itemStyle: { color: packBar.itemColors[i] },
                })),
              },
            ],
          },
          true,
        )
        chart.resize()
      } catch (err) {
        setChartErrors((prev) => ({ ...prev, [comp.id]: `柱状图渲染失败: ${String(err?.message || err)}` }))
      }
    }

    React.useEffect(() => {
      const onResize = () => {
        for (const id of Object.keys(uplotRefs.current)) {
          const u = uplotRefs.current[id]
          if (u?._node && u.setSize)
            try {
              u.setSize({ width: u._node.clientWidth || 420, height: 150 })
            } catch {}
        }
        for (const id of Object.keys(echartRefs.current)) {
          const chart = echartRefs.current[id]
          if (chart && typeof chart.resize === 'function')
            try {
              chart.resize()
            } catch {}
        }
      }
      if (typeof globalThis !== 'undefined' && globalThis.window) globalThis.window.addEventListener('resize', onResize)
      return () => {
        if (typeof globalThis !== 'undefined' && globalThis.window)
          globalThis.window.removeEventListener('resize', onResize)
        for (const id of Object.keys(uplotRefs.current)) {
          try {
            uplotRefs.current[id]?.destroy()
          } catch {}
        }
        uplotRefs.current = {}
        for (const id of Object.keys(echartRefs.current)) {
          try {
            echartRefs.current[id]?.dispose()
          } catch {}
        }
        echartRefs.current = {}
      }
    }, [])

    const barDataOf = (comp) => {
      const latest = componentLatestValues(values, points, comp.pointIds)
      return { latest }
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
      dispatchAgentRef(ref, agentBridge)
        .then((res) => {
          if (!aliveRef.current || token !== copyToken.current) return
          if (!res || !res.ok) {
            setCopied('复制失败')
            return
          }
          setCopied(
            `${res.mode === 'input' ? '已加入输入框' : res.mode === 'sent' ? '已发送' : '已复制组件引用'} · ${comp.name}`,
          )
          copyClearTimer.current = setTimeout(() => {
            copyClearTimer.current = 0
            if (aliveRef.current && token === copyToken.current) setCopied('')
          }, 2500)
        })
        .catch(() => {
          if (!aliveRef.current || token !== copyToken.current) return
          setCopied('复制失败')
          copyClearTimer.current = setTimeout(() => {
            copyClearTimer.current = 0
            if (aliveRef.current && token === copyToken.current) setCopied('')
          }, 2500)
        })
      try {
        postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
          if (aliveRef.current) setNote(reason)
        })
      } catch {}
    }

    function renderer(comp, latest, byId, degraded) {
      if (degraded) {
        if (comp.type === 'line') destroyChart(comp.id)
        return el(
          'div',
          { className: 'dvb-viz-body' },
          el(
            'div',
            { className: 'dvb-hint dvb-need' },
            '关联点位已关闭监视或被删除；请编辑组件恢复或选择新的监视点位。',
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              disabled: vizReadOnly,
              title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
              onClick() {
                openEditor(comp)
              },
            },
            '修复',
          ),
        )
      }
      if (comp.type === 'line') {
        return renderLineRenderer(el, {
          comp,
          payload: seriesOfComponent(comp),
          chartErr: chartErrors[comp.id],
          ensureChart,
          openEditor,
          setChartErrors,
          setTick,
          t,
          readOnly: vizReadOnly,
        })
      }
      if (comp.type === 'bar')
        return renderBarRenderer(el, {
          ...barDataOf(comp),
          comp,
          ensureChart: getEcharts() ? ensureBarChart : undefined,
        })
      if (comp.type === 'value') return renderValueRenderer(el, { latest })
      if (comp.type === 'switch') {
        const item = latest[0] || {}
        const pt = byId.get(comp.pointIds[0]) || {}
        const pending = switchDraft.current
        const busy = !!(pending?.busy && pending.componentId === comp.id)
        const confirmHint =
          pending && pending.componentId === comp.id && !pending.busy && pending.expiresAt > Date.now()
            ? `确认写入「${pending.desiredValue ? '开' : '关'}」…`
            : ''
        return renderSwitchRenderer(el, {
          item,
          pt,
          on: item.value === 1 || item.value === true,
          busy,
          confirmHint,
          cwd,
          readOnly: vizReadOnly,
          readOnlyTitle: vizReadOnly ? t('vizReadOnlyAction') : undefined,
          onToggle(wantOn) {
            toggleSwitch(
              comp,
              { connectionId: pt.connectionId, deviceId: pt.deviceId, pointId: pt.id, address: pt.address },
              wantOn,
            )
          },
        })
      }
      return null
    }

    const componentCard = (comp) => {
      const status = visualizationComponentStatus(comp, points)
      const byId = new Map(points.map((p) => [p.id, p]))
      const latest = componentLatestValues(values, points, comp.pointIds)
      const degraded = status !== 'ok'
      return el(
        'div',
        {
          key: comp.id,
          className: `dvb-panel dvb-viz-card${degraded ? ' dvb-viz-degraded' : ''}${deleteId === comp.id ? ' dvb-viz-confirm' : ''}${focusVizId === comp.id ? ' dvb-viz-focused' : ''}`,
        },
        el(
          'div',
          { className: 'dvb-viz-head' },
          el(
            'div',
            { className: 'dvb-viz-head-main' },
            el(
              'div',
              { className: 'dvb-viz-title-row' },
              el('span', { className: 'dvb-viz-drag', title: '拖动排列' }, '⋮⋮'),
              el('span', { className: 'dvb-viz-title' }, comp.name),
              el('span', { className: 'dvb-viz-type' }, vizTypeLabel(comp.type)),
            ),
            el(
              'div',
              { className: 'dvb-viz-meta' },
              el('span', null, `${comp.pointIds.length} 个点位`),
              degraded ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, '数据源不可用') : null,
            ),
          ),
          el(
            'div',
            { className: 'dvb-viz-head-actions' },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                title: hasHarnessInput(props)
                  ? '将组件引用加入当前 Session 输入框并让 Agent 分析'
                  : '复制组件结构化引用',
                'aria-label': `让 Agent 分析组件 ${comp.name || comp.id}`,
                onClick() {
                  copyComponentRef(comp)
                },
              },
              hasHarnessInput(props) ? '让 Agent 分析' : '复制引用',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                disabled: vizReadOnly,
                title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                onClick() {
                  openEditor(comp)
                },
              },
              '编辑',
            ),
            deleteId === comp.id
              ? el(
                  'span',
                  { className: 'dvb-actions' },
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
                      disabled: vizReadOnly,
                      title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                      onClick() {
                        removeComponent(comp.id)
                      },
                    },
                    '确认删除',
                  ),
                  el(
                    'button',
                    {
                      type: 'button',
                      className: 'dvb-btn dvb-btn-sm',
                      onClick() {
                        setDeleteId('')
                      },
                    },
                    t('csvCancel') || '取消',
                  ),
                )
              : el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
                    disabled: vizReadOnly,
                    title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                    onClick() {
                      setDeleteId(comp.id)
                    },
                  },
                  '删除',
                ),
          ),
        ),
        el('div', { className: 'dvb-viz-body-wrap' }, renderer(comp, latest, byId, degraded)),
      )
    }

    const pointOptions = pack ? monitoredPointOptions(pack) : []
    const byPointId = new Map(points.map((p) => [p.id, p]))
    const editorOpts = editor
      ? pointOptions.filter((o) => {
          if (editor.search) {
            const hit = `${o.name} ${o.path} ${o.pointId}`.toLowerCase().includes(editor.search.toLowerCase())
            if (!hit) return false
          }
          return pointCompatible(editor.type, o.function) || editor.pointIds.includes(o.pointId)
        })
      : []
    // 已选但不在 monitored 列表中的不兼容点：仍展示
    const orphanSelected = editor
      ? (editor.pointIds || [])
          .filter((pid) => !pointOptions.some((o) => o.pointId === pid))
          .map((pid) => {
            const pt = byPointId.get(pid)
            return {
              pointId: pid,
              name: pt?.name || pid,
              path: '已选 · 当前不可用',
              function: pt ? pt.function : 0,
            }
          })
      : []
    const pickerRows = editorOpts.concat(orphanSelected.filter((o) => !editorOpts.some((x) => x.pointId === o.pointId)))
    const selectedIncompatible = editor
      ? (editor.pointIds || []).filter((pid) => {
          const pt = byPointId.get(pid)
          return !pt || !pointCompatible(editor.type, pt.function)
        })
      : []
    const editorCheck = editorValidation()
    const singleSelect = editor && (editor.type === 'value' || editor.type === 'switch')

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
          el('span', { className: 'dvb-map-meta' }, `${components.length} 个组件`),
        ),
        !editor
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-primary',
                disabled: !cwd || vizReadOnly,
                title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                onClick() {
                  openEditor(null)
                },
              },
              t('vizNew') || '新建组件',
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
            el('div', { className: 'grid-stack-item-content' }, componentCard(comp)),
          )
        }),
      ),
      !components.length && !editor
        ? el(
            'div',
            { className: 'dvb-empty dvb-viz-empty' },
            el('div', { className: 'dvb-viz-empty-title' }, t('vizEmptyPoint') || '还没有可视化组件'),
            el(
              'div',
              { className: 'dvb-hint' },
              pointOptions.length ? '从已监视点位创建曲线、柱状图、数值或开关组件' : '请先在上位机点位表开启「监视」',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-primary',
                disabled: !cwd || !pointOptions.length || vizReadOnly,
                title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                onClick() {
                  openEditor(null)
                },
              },
              t('vizNew') || '新建组件',
            ),
          )
        : null,
      editor
        ? el(
            'div',
            { className: 'dvb-panel dvb-write-panel' },
            el(
              'div',
              { className: 'dvb-panel-head' },
              el(
                'span',
                { className: 'dvb-panel-title' },
                editor.id ? t('vizEdit') || '编辑组件' : t('vizNew') || '新建组件',
              ),
            ),
            el(
              'div',
              { className: 'dvb-toolbar' },
              vizFieldOf(
                el,
                t('vizName') || '组件名称',
                el('input', {
                  className: 'dvb-input',
                  value: editor.name,
                  placeholder: '如 送风温度趋势',
                  onChange: (e) => setEditor((prev) => ({ ...prev, name: e.target.value })),
                }),
              ),
              vizFieldOf(
                el,
                t('vizType') || '组件类型',
                el(CustomSelect, {
                  value: editor.type,
                  options: [...COMPONENT_TYPES].map((ty) => ({ value: ty, label: vizTypeLabel(ty) })),
                  onChange(val) {
                    const nextType = val?.target ? val.target.value : val
                    setEditor((prev) => ({ ...prev, type: nextType }))
                  },
                }),
              ),
            ),
            el(
              'div',
              { className: 'dvb-viz-picker' },
              el('input', {
                className: 'dvb-input dvb-map-search',
                placeholder: t('vizSearch') || '搜索已监视点位…',
                value: editor.search,
                onChange: (e) => setEditor((prev) => ({ ...prev, search: e.target.value })),
              }),
              el(
                'div',
                { className: 'dvb-viz-picker-list' },
                pickerRows.length
                  ? pickerRows.map((o) => {
                      const incompatible = !pointCompatible(editor.type, o.function)
                      const checked = editor.pointIds.includes(o.pointId)
                      return el(
                        'label',
                        { key: o.pointId, className: 'dvb-viz-picker-opt', title: o.path },
                        el('input', {
                          type: singleSelect ? 'radio' : 'checkbox',
                          name: singleSelect ? `viz-point-${editor.id || 'new'}` : undefined,
                          checked,
                          onChange: () => {
                            setEditor((prev) => {
                              if (singleSelect) return { ...prev, pointIds: [o.pointId] }
                              const has = prev.pointIds.includes(o.pointId)
                              return {
                                ...prev,
                                pointIds: has
                                  ? prev.pointIds.filter((x) => x !== o.pointId)
                                  : prev.pointIds.concat([o.pointId]),
                              }
                            })
                          },
                        }),
                        el('span', null, o.name),
                        incompatible ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, '不兼容') : null,
                        incompatible
                          ? el(
                              'button',
                              {
                                type: 'button',
                                className: 'dvb-btn dvb-btn-sm',
                                onClick: (ev) => {
                                  ev.preventDefault()
                                  setEditor((prev) => ({
                                    ...prev,
                                    pointIds: prev.pointIds.filter((x) => x !== o.pointId),
                                  }))
                                },
                              },
                              '移除',
                            )
                          : null,
                        el('span', { className: 'dvb-hint', style: { marginLeft: '8px' } }, o.path),
                      )
                    })
                  : el(
                      'div',
                      { className: 'dvb-hint' },
                      pointOptions.length
                        ? t('vizNoCompatiblePoints') || '当前组件类型没有可用的已监视点位'
                        : t('vizNoMonitoredPoints') || '暂无可用点位，请先在上位机点位表中开启“监视”',
                    ),
              ),
            ),
            selectedIncompatible.length
              ? el(
                  'div',
                  { className: 'dvb-hint dvb-need' },
                  `已选但不兼容的点位：${selectedIncompatible.join(', ')}（请移除或改回兼容类型）`,
                )
              : null,
            editor.pointIds.length
              ? el('div', { className: 'dvb-hint' }, `已选 ${editor.pointIds.length} 个点位`)
              : null,
            !editorCheck.ok && editorCheck.reason
              ? el('div', { className: 'dvb-hint dvb-need' }, editorCheck.reason)
              : null,
            el(
              'div',
              { className: 'dvb-actions' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  disabled: saving,
                  onClick() {
                    setEditor(null)
                  },
                },
                t('csvCancel') || '取消',
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-primary',
                  disabled: saving || !editorCheck.ok || vizReadOnly,
                  title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                  onClick: saveComponent,
                },
                saving ? '保存中…' : editor.id ? t('vizSave') || '保存修改' : t('vizCreate') || '创建组件',
              ),
            ),
          )
        : null,
    )
  }
}
