// TaskP2/0.20.0: 侧边栏「可视化」— 以组件为中心（line/bar/value/switch）。
// 组件编辑器：名称/类型/关联点位搜索多选（仅 monitorEnabled，限定路径）。
// 渲染来源：line → modbus.trend（uPlot）；bar → 最新 values（uPlot bars）；
// value → 数值卡；switch → FC01 写点（确认后写入并读回）。
import { subscribeState, buildAgentRef, copyAgentRef, hasHarnessInput } from './bench-shared.mjs'
import { sessionCwd } from './bench-live.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { TREND_WINDOW_MS, trendDataForComponents, componentLatestValues, UPLOT_PROTO } from './bench-trend.mjs'
import { vendorUPlot } from './bench-vendor.mjs'
import {
  COMPONENT_TYPES,
  monitoredPointOptions,
  normalizeVisualizationComponent,
  validateVisualizationComponent,
  visualizationComponentStatus,
} from './bench-visualization-model.mjs'
const VIZ_COLORS = ['#4f8ef7', '#2eaf64', '#e0912f', '#c85454', '#8f63d2', '#2fa8a8', '#d27ab0', '#7a8494']

export function createVisualizationPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  const el = React.createElement
  return function VisualizationPage(props) {
    const cwd = (props && props.scope && props.scope.cwd) || sessionCwd(props) || ''
    const [mb, setMb] = React.useState(null)
    const [editor, setEditor] = React.useState(null) // { id, name, type, pointIds, search }
    const [deleteId, setDeleteId] = React.useState('')
    const [copied, setCopied] = React.useState('')
    const [note, setNote] = React.useState('')
    const [, setTick] = React.useState(0)
    const uplotRefs = React.useRef({})
    const switchDraft = React.useRef(null)

    React.useEffect(() => {
      if (!cwd || !post) return undefined
      let stop = false
      post('/dsh-vision-bench/state', { cwd }).then((data) => { if (!stop && data) setMb(data.workspace && data.workspace.modbus || null) }).catch(() => {})
      const unsub = subscribeState(post, cwd, (data) => {
        if (stop || !data) return
        const next = data.workspace && data.workspace.modbus
        if (next) setMb(next)
      })
      return () => { stop = true; if (typeof unsub === 'function') unsub() }
    }, [cwd, post])

    React.useEffect(() => {
      const timer = setInterval(() => setTick((n) => n + 1), 1000)
      return () => clearInterval(timer)
    }, [])

    const pack = (() => { try { return normalizeModbus(mb || {}) } catch { return null } })()
    const points = pack ? (pack.points || []) : []
    const viz = pack ? (pack.visualization || { schemaVersion: 1, components: [] }) : { schemaVersion: 1, components: [] }
    const components = (viz && Array.isArray(viz.components)) ? viz.components : []
    const values = pack ? (pack.values || []) : []
    const trendStore = pack ? (pack.trend || {}) : {}

    // 组件保存（持久化到工作区，递增 configVersion）
    function saveComponent() {
      if (!editor) return
      if (!String(editor.name || '').trim()) { setNote('请填写组件名称'); return }
      const cand = normalizeVisualizationComponent({ id: editor.id, name: editor.name, type: editor.type, pointIds: editor.pointIds })
      const v = validateVisualizationComponent(cand, points)
      if (!v.ok) { setNote(v.error); return }
      const next = { schemaVersion: 1, components: components.filter((c) => c.id !== editor.id).concat([cand]) }
      persistViz(next)
      setEditor(null)
      setNote('')
    }
    function persistViz(next) {
      post('/dsh-vision-bench/workspace', { cwd, modbus: { visualization: next, version: 3 } }).then((data) => {
        if (data && data.ok === false) setNote(data.error || '保存失败')
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (data && data.workspace) setMb(data.workspace.modbus)
      }).catch((err) => setNote(String((err && err.message) || '保存失败')))
    }
    function removeComponent(id) {
      const next = { schemaVersion: 1, components: components.filter((c) => c.id !== id) }
      persistViz(next)
      setDeleteId('')
    }
    function openEditor(comp) {
      setErrorless()
      setEditor({
        id: comp ? comp.id : '',
        name: comp ? comp.name : ('组件' + (components.length + 1)),
        type: comp ? comp.type : 'line',
        pointIds: comp ? comp.pointIds.slice() : [],
        search: '',
      })
    }
    function setErrorless() { setNote('') }

    // 开关写入（确认后写入并读回）
    function toggleSwitch(comp, point, wantOn) {
      if (!cwd) return
      const settings = comp.settings || {}
      if (settings.confirmWrite !== false && switchDraft.current !== comp.id + ':' + point.pointId) {
        switchDraft.current = comp.id + ':' + point.pointId
        setNote('再次点击「' + (wantOn ? '开' : '关') + '」确认写入')
        return
      }
      switchDraft.current = null
      post('/dsh-vision-bench/modbus/write', {
        cwd,
        source: 'user',
        sessionId: (props && props.sessionId) || '',
        connectionId: point.connectionId,
        deviceId: point.deviceId,
        pointId: point.pointId,
        function: 1,
        address: point.address,
        values: [wantOn ? 1 : 0],
      }).then((data) => {
        setNote(data && data.ok === false ? (data.error || '写入失败') : '写入成功')
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (data && data.workspace) setMb(data.workspace.modbus)
      }).catch((err) => setNote(String((err && err.message) || '写入失败')))
    }

    const linePayloadCache = {}
    const seriesOfComponent = (comp) => {
      const key = comp.id
      if (!linePayloadCache[key]) {
        linePayloadCache[key] = trendDataForComponents(trendStore, points, comp.pointIds, (comp.settings && comp.settings.windowMs) || TREND_WINDOW_MS)
      }
      return linePayloadCache[key]
    }

    const ensureUplot = (node, comp) => {
      if (!node) return
      const payload = seriesOfComponent(comp)
      const existing = uplotRefs.current[comp.id]
      if (existing && existing._node === node) {
        // 组件序列集合不变 → setData 实时更新
        try { if (payload.keys.length && existing.setData) existing.setData(payload.data) } catch {}
        return
      }
      if (payload.keys.length && vendorUPlot()) {
        try {
          if (existing) existing.destroy()
          const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
          const opts = {
            ...UPLOT_PROTO,
            width: node.clientWidth || 420,
            height: 150,
            pxRatio: (typeof window !== 'undefined' && window.devicePixelRatio) || 1,
            scales: { x: { time: true }, y: { auto: true } },
            axes: [
              { stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)', grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' } },
              { stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)', grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' } },
            ],
            series: [{ label: 'time' }].concat(payload.keys.map((k, i) => ({ label: (payload.meta[i] && payload.meta[i].label) || k, stroke: VIZ_COLORS[i % VIZ_COLORS.length], width: 1.5, spanGaps: false, points: { show: false } }))),
          }
          const c = new vendorUPlot()(opts, payload.data, node)
          c._node = node
          uplotRefs.current[comp.id] = c
        } catch { /* uPlot 不可用时降级为提示 */ }
      }
    }

    // 卸载清理 + resize 适配
    React.useEffect(() => {
      const onResize = () => {
        for (const id of Object.keys(uplotRefs.current)) {
          const u = uplotRefs.current[id]
          if (u && u._node && u.setSize) try { u.setSize({ width: u._node.clientWidth || 420, height: 150 }) } catch {}
        }
      }
      if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
      return () => {
        if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
        for (const id of Object.keys(uplotRefs.current)) {
          try { uplotRefs.current[id] && uplotRefs.current[id].destroy() } catch {}
        }
        uplotRefs.current = {}
      }
    }, [])

    const barDataOf = (comp) => {
      const latest = componentLatestValues(values, points, comp.pointIds)
      const xs = latest.map((_, i) => i)
      const vs = latest.map((l) => (l.ok && l.value != null) ? Number(l.value) : null)
      return { xs, vs, latest }
    }

    const componentCard = (comp) => {
      const status = visualizationComponentStatus(comp, points)
      const opts = monitoredPointOptions(pack || {}) // 渲染用元数据（映射到实际点位）
      const byId = new Map(points.map((p) => [p.id, p]))
      const latest = componentLatestValues(values, points, comp.pointIds)
      const degraded = status !== 'ok'
      return el('div', { key: comp.id, className: 'dvb-panel dvb-viz-card' + (degraded ? ' dvb-viz-degraded' : '') + (deleteId === comp.id ? ' dvb-viz-confirm' : '') },
        el('div', { className: 'dvb-viz-head' },
          el('span', { className: 'dvb-viz-title' }, comp.name),
          el('span', { className: 'dvb-tag' }, vizTypeLabel(comp.type)),
          el('span', { className: 'dvb-tag' }, comp.pointIds.length + ' 点位'),
          degraded ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, '数据源未监视/缺失 — 请修复') : null,
          el('div', { className: 'dvb-actions' },
            hasHarnessInput ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm dvb-btn-icon', title: '复制组件结构化引用并让 Agent 分析', 'aria-label': '复制组件引用 ' + comp.name, onClick() { copyComponentRef(comp) } }, 'ⓘ') : null,
            deleteId === comp.id
              ? el('span', { className: 'dvb-actions' },
                  el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm dvb-btn-danger', onClick() { removeComponent(comp.id) } }, '确认删除'),
                  el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { setDeleteId('') } }, t('csvCancel') || '取消'))
              : el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', title: '删除组件', 'aria-label': '删除组件 ' + comp.name, onClick() { setDeleteId(comp.id) } }, '🗑'),
            el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', title: '编辑组件（名称/类型/关联点位）', 'aria-label': '编辑组件 ' + comp.name, onClick() { openEditor(comp) } }, '✎'))),
        renderer(comp, latest, byId, degraded))
    }

    function renderer(comp, latest, byId, degraded) {
      if (degraded) {
        return el('div', { className: 'dvb-viz-body' },
          el('div', { className: 'dvb-hint dvb-need' }, '关联点位已关闭监视或被删除；请编辑组件恢复或选择新的监视点位。'),
          el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { openEditor(comp) } }, '修复'))
      }
      if (comp.type === 'line') {
        const payload = seriesOfComponent(comp)
        return el('div', { className: 'dvb-viz-body' },
          payload.keys.length
            ? el('div', { ref: (node) => { if (node) ensureUplot(node, comp) }, className: 'dvb-viz-uplot', style: { width: '100%', height: '150px' } })
            : el('div', { className: 'dvb-hint' }, '暂无历史样本，等待采集…'))
      }
      if (comp.type === 'bar') {
        const bd = barDataOf(comp)
        return el('div', { className: 'dvb-viz-body' },
          el('div', { className: 'dvb-viz-bars' },
            bd.latest.map((item) => el('div', { key: item.pointId, className: 'dvb-viz-bar-row' },
              el('span', { className: 'dvb-viz-bar-name', title: item.name }, item.name),
              el('div', { className: 'dvb-viz-bar-track' },
                el('div', { className: 'dvb-viz-bar-fill', style: { width: '100%', height: '100%' } })),
              el('span', { className: 'dvb-viz-bar-val' }, item.ok && item.value != null ? String(item.value) + (item.unit ? ' ' + item.unit : '') : '—')))),
          el('div', { className: 'dvb-hint' }, '柱高按当前值相对比例显示（最新 values）'))
      }
      if (comp.type === 'value') {
        const item = latest[0] || {}
        return el('div', { className: 'dvb-viz-body dvb-viz-value-card' },
          el('span', { className: 'dvb-viz-value-name' }, item.name || ''),
          el('span', { className: 'dvb-viz-value' + (item.ok ? '' : ' dvb-viz-value-stale') },
            item.ok && item.value != null ? String(item.value) : '—'),
          el('span', { className: 'dvb-viz-value-unit' }, (item.ok && item.value != null && item.unit) ? item.unit : ''))
      }
      if (comp.type === 'switch') {
        const item = latest[0] || {}
        const pt = byId.get(comp.pointIds[0]) || {}
        const on = item.value === 1 || item.value === true
        return el('div', { className: 'dvb-viz-body dvb-viz-switch-card' },
          el('span', { className: 'dvb-viz-value-name' }, item.name || ''),
          el('span', { className: 'dvb-viz-value' }, on ? 'ON' : 'OFF'),
          el('div', { className: 'dvb-actions' },
            el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm dvb-btn-primary', disabled: !cwd || !pt.function, onClick() { toggleSwitch(comp, { connectionId: pt.connectionId, deviceId: pt.deviceId, pointId: pt.id, address: pt.address }, true) } }, '开'),
            el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', disabled: !cwd || !pt.function, onClick() { toggleSwitch(comp, { connectionId: pt.connectionId, deviceId: pt.deviceId, pointId: pt.id, address: pt.address }, false) } }, '关')))
      }
      return null
    }

    function copyComponentRef(comp) {
      const ref = buildAgentRef('visualization', { visualizationId: comp.id, type: comp.type, pointIds: comp.pointIds, name: comp.name }, { configVersion: pack && pack.configVersion || 1, start: Date.now() - TREND_WINDOW_MS, end: Date.now() })
      copyAgentRef(ref, () => setCopied('已复制组件引用'))
      setTimeout(() => setCopied(''), 2000)
    }

    const pointOptions = pack ? monitoredPointOptions(pack) : []
    const editorOpts = editor
      ? pointOptions.filter((o) => !editor.search || (o.name + ' ' + o.path + ' ' + o.pointId).toLowerCase().includes(editor.search.toLowerCase()))
      : []

    return el('div', { className: 'dvb-live dvb-viz' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveChart') || '可视化'),
        el('span', { className: 'dvb-map-meta' }, components.length + ' 组件'),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick() { openEditor(null) } }, t('vizNew') || '＋新建组件')),
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      note ? el('div', { className: 'dvb-hint' }, note) : null,
      el('div', { className: 'dvb-viz-list' }, components.map(componentCard)),
      !components.length && !editor
        ? el('div', { className: 'dvb-empty' },
            el('div', null, t('vizEmptyPoint') || '还没有可视化组件'),
            el('button', { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd || !pointOptions.length, onClick() { openEditor(null) } }, t('vizNew') || '＋新建组件'))
        : null,
      editor
        ? el('div', { className: 'dvb-panel dvb-write-panel' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, (editor.id ? t('vizEdit') || '编辑组件' : t('vizNew') || '新建组件')),
            el('button', { type: 'button', className: 'dvb-btn', onClick() { setEditor(null) } }, t('csvCancel') || '取消')),
          el('div', { className: 'dvb-toolbar' },
            vizFieldOf(el, t('vizName') || '组件名称', el('input', { className: 'dvb-input', value: editor.name, placeholder: '如 送风温度趋势', onChange: (e) => setEditor((prev) => ({ ...prev, name: e.target.value })) })),
            vizFieldOf(el, t('vizType') || '组件类型', el('select', { className: 'dvb-input', value: editor.type, onChange: (e) => setEditor((prev) => ({ ...prev, type: e.target.value })) },
              ...[...COMPONENT_TYPES].map((ty) => el('option', { key: ty, value: ty }, vizTypeLabel(ty))))),
            el('button', { type: 'button', className: 'dvb-btn dvb-btn-primary', onClick: saveComponent }, t('savePoint') || '保存')),
          el('div', { className: 'dvb-viz-picker' },
            el('input', { className: 'dvb-input dvb-map-search', placeholder: t('vizSearch') || '搜索已监视点位…', value: editor.search, onChange: (e) => setEditor((prev) => ({ ...prev, search: e.target.value })) }),
            el('div', { className: 'dvb-viz-picker-list' },
              editorOpts.length
                ? editorOpts.map((o) => el('label', { key: o.pointId, className: 'dvb-viz-picker-opt', title: o.path },
                    el('input', {
                      type: 'checkbox',
                      checked: editor.pointIds.includes(o.pointId),
                      onChange: (e) => {
                        setEditor((prev) => {
                          const has = prev.pointIds.includes(o.pointId)
                          return { ...prev, pointIds: has ? prev.pointIds.filter((x) => x !== o.pointId) : prev.pointIds.concat([o.pointId]) }
                        })
                      },
                    }),
                    el('span', null, o.name),
                    el('span', { className: 'dvb-hint', style: { marginLeft: '8px' } }, o.path)))
                : el('div', { className: 'dvb-hint' }, pointOptions.length ? '无匹配点位' : (t('trendEmptyHint') || '请先在上位机点位配置中开启监视'))),
          editor.pointIds.length ? el('div', { className: 'dvb-hint' }, '已选 ' + editor.pointIds.length + ' 个点位') : null))
      : null)
  }
}

const vizTypeLabel = (type) => ({ line: '曲线图', bar: '柱状图', value: '数值卡', switch: '开关' }[type] || type)

const vizFieldOf = (el, label, control) => el('div', { className: 'dvb-row' }, el('div', { className: 'dvb-label' }, el('span', null, label)), control)
