import { pushFramesLog, subscribeState, getFramesLog, clearFramesLog, resolveSidebarScope, getSidebarPin, setSidebarPin, buildAgentRef, copyAgentRef, dispatchAgentRef, hasHarnessInput, agentRefToText, getFocusState, setFocusState, isFocusTarget, focusHighlightClass, getTempWatch, setTempWatch, clearTempWatch, shouldStealFocus, shouldHighlightFocus } from './bench-shared.mjs'
import { postEvidence, evidenceFromRef, readInputDraft, buildInputBridge } from './bench-shared.mjs'
import { clockOf, decodeValue, functionTag } from './bench-points.mjs'
import { NS } from './bench-i18n.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { TREND_WINDOW_MS, trendKey, toUplotData, UPLOT_PROTO } from './bench-trend.mjs'
import { normalizeAlarmState, groupAlarms, acknowledgeAlarm, ACTIVE, RECOVERED, ACKED, PROCESS, COMM, COND_ACTIVE, COND_RECOVERED } from './bench-alarm.mjs'
import { vendorUPlot, vendorVirtualizer, vendorAvailable } from './bench-vendor.mjs'
import { canUseModbus } from './bench-io-capability.mjs'

const TAB_TABLE = 'dsh-vision-bench:modbus'
const TAB_CHART = 'dsh-vision-bench:charts'
const TAB_ALARM = 'dsh-vision-bench:alarms'
const TAB_FRAMES = 'dsh-vision-bench:frames'
export const TAB_LOG = 'dsh-vision-bench:log'
const INTERVALS = [500, 1000, 2000, 5000]

function normalizePointsSafe(pack) {
  return Array.isArray(pack.points) ? pack.points : []
}

const TREND_COLORS = ['#4f8ef7', '#2eaf64', '#e0912f', '#c85454', '#8f63d2', '#2fa8a8', '#d27ab0', '#7a8494']

export function sessionCwd(props) {
  if (props && props.scope && props.scope.cwd) return props.scope.cwd
  const sessionId = (props && props.scope && props.scope.sessionId) || (props && props.sessionId)
  return props && props.useSessions
    ? props.useSessions((s) => {
      if (sessionId && s.byId && s.byId[sessionId] && s.byId[sessionId].cwd) return s.byId[sessionId].cwd
      const id = s && s.current
      return (s && s.byId && id && s.byId[id] && s.byId[id].cwd) || ''
    })
    : ''
}

const displayValue = (rec, point) => {
  if (!rec || rec.value === null || rec.value === undefined) return '—'
  if (rec.ok === false && rec.error) return rec.error
  let shown = rec.value
  if (typeof shown === 'number' && point) shown = decodeValue(point, shown)
  const text = typeof shown === 'boolean' ? (shown ? '1' : '0') : String(shown)
  return point && point.unit ? text + ' ' + point.unit : text
}

export function getBetterSidebar(ctx) {
  try {
    return (ctx && ctx.betterSidebar) || (ctx && ctx.get && ctx.get('betterSidebar')) || null
  } catch {
    return null
  }
}

export const drawTrend = (container, cwd = '', now = Date.now(), payload) => {
  if (!container) return null
  const UPlot = vendorUPlot()
  if (!UPlot) return null
  // Task3/0.19.3: 优先使用调用方传入的存储载荷；旧签名回退客户端缓存
  const usePayload = payload && Array.isArray(payload.data) ? payload : toUplotData(cwd, { now, windowMs: TREND_WINDOW_MS })
  const { data, keys, meta } = usePayload
  const isDark = typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches
  const dpr = (typeof window !== 'undefined' && window.devicePixelRatio) || 1
  const ks = keys.slice(0, 8), ms = meta.slice(0, 8)
  const opts = {
    ...UPLOT_PROTO, width: container.clientWidth || 560, height: 190, pxRatio: dpr,
    spanGaps: false,
    cursor: { drag: { x: true, y: false, uni: 10 } },
    select: { show: true },
    scales: { x: { time: true }, y: { auto: true } },
    axes: [
      { stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)', grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' } },
      { stroke: isDark ? 'rgba(255,255,255,.72)' : 'rgba(0,0,0,.72)', grid: { stroke: isDark ? 'rgba(255,255,255,.08)' : 'rgba(0,0,0,.08)' } },
    ],
    series: [{ label: 'time' }].concat(ks.map((k, i) => ({
      label: (ms[i] && ms[i].label) || k,
      stroke: TREND_COLORS[i % 8],
      width: 1.5,
      spanGaps: false,
      points: { show: false },
    }))),
    hooks: {
      setSelect: [(u) => {
        try {
          const s = u.select
          container._uplotSel = !s || !s.width ? null : { start: Math.round(u.posToVal(s.left, 'x') * 1000), end: Math.round(u.posToVal(s.left + s.width, 'x') * 1000) }
        } catch { container._uplotSel = null }
      }],
    },
  }
  try { return new UPlot(opts, data, container) } catch { return null }
}

export function createTrendPage(React, t, post, hooks) {
  return function TrendPage(props) {
    const el = React.createElement
    const cwd = (props && props.scope && props.scope.cwd) || sessionCwd(props) || ''
    const wrapRef = React.useRef(null)
    const uplotRef = React.useRef(null)
    const mountKeyRef = React.useRef('')
    const [paused, setPaused] = React.useState(false)
    const [, setTick] = React.useState(0)
    const [copied, setCopied] = React.useState('')
    const [exportNote, setExportNote] = React.useState('')
    const [configVersion, setConfigVersion] = React.useState(0)
    const [cvReady, setCvReady] = React.useState(false)
    const [evNote, setEvNote] = React.useState('')

    // Task4/0.18.3: agent input bridge read at the TOP of the render (no Hooks
    // inside click handlers); preserves existing draft text, clipboard fallback
    // when the harness has no writer.
    const inputDraft = readInputDraft(props && props.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)

    // Task3/0.19.3: 曲线数据来自工作区 trend 存储（提交阶段采样），页面只消费
    const [mbStore, setMbStore] = React.useState(null)
    const applyCv = (data) => {
      const mb = data && data.workspace && data.workspace.modbus
      const v = Number(mb && mb.configVersion)
      setConfigVersion(v > 0 ? v : 0)
      setCvReady(true)
      if (mb) setMbStore(mb)
    }
    React.useEffect(() => {
      if (!cwd || !post) { setCvReady(true); return }
      let stop = false
      post('/dsh-vision-bench/state', { cwd }).then((data) => {
        if (!stop) applyCv(data)
      }).catch(() => { if (!stop) setCvReady(true) })
      const unsub = subscribeState(post, cwd, (data) => { if (data && !stop) applyCv(data) })
      return () => { stop = true; if (typeof unsub === 'function') unsub() }
    }, [cwd, post])

    React.useEffect(() => {
      if (paused) return
      const timer = setInterval(() => setTick((n) => n + 1), 500)
      return () => clearInterval(timer)
    }, [paused])

    // 从工作区 trend 存储构建显示载荷（只显示 trendEnabled 点位，最多 8 条）
    const trendPayload = (() => {
      const mb = mbStore || null
      if (!mb) return { data: [], keys: [], meta: [], entries: [] }
      const trend = (mb && mb.trend) || {}
      const pts = (() => { try { return normalizeModbus(mb).points || [] } catch { return [] } })()
      const selected = pts.filter((p) => p.trendEnabled === true).slice(0, 8)
      const data = [], keys = [], meta = [], entries = []
      selected.forEach((pt, idx) => {
        const list = Array.isArray(trend[pt.id]) ? trend[pt.id] : []
        const now = Date.now()
        const window = list.filter((sv) => Array.isArray(sv) && sv[0] >= now - TREND_WINDOW_MS)
        if (!window.length) return
        const xs = [], vs = []
        let min = Infinity, max = -Infinity, any = false
        for (const sv of window) {
          xs.push(sv[0]); vs.push(sv[1] == null ? null : Number(sv[1]))
          if (sv[1] != null && Number.isFinite(Number(sv[1]))) { any = true; min = Math.min(min, Number(sv[1])); max = Math.max(max, Number(sv[1])) }
        }
        const tk = trendKey(pt.connectionId || 'c1', pt.deviceId || 'd1', pt.id)
        keys.push(tk)
        meta.push({ label: pt.name || (functionTag(pt.function) + pt.address), unit: pt.unit || '' })
        data.push(xs, vs)
        const last = window[window.length - 1]
        entries.push({ key: tk, label: pt.name || (functionTag(pt.function) + pt.address), unit: pt.unit || '', last: { t: last[0], v: last[1] }, lastValid: any, min: any ? min : null, max: any ? max : null, color: TREND_COLORS[idx % TREND_COLORS.length] })
      })
      return { data, keys, meta, entries }
    })()

    const entries = trendPayload.entries
    const chartMountKey = entries.map((e) => e.key).join('|')

    // Task5: build uPlot once; rebuild only when the series set changes.
    React.useEffect(() => {
      if (!entries.length || !vendorAvailable()) return
      const c = wrapRef.current
      if (!c) return
      if (mountKeyRef.current !== chartMountKey) {
        if (uplotRef.current) { try { uplotRef.current.destroy() } catch {} uplotRef.current = null }
        mountKeyRef.current = chartMountKey
      }
      if (!uplotRef.current) uplotRef.current = drawTrend(c, cwd, Date.now(), trendPayload)
      const u = uplotRef.current
      const onResize = () => { const cc = wrapRef.current; if (u && cc && u.setSize) u.setSize({ width: cc.clientWidth || 560, height: 190 }) }
      if (typeof window !== 'undefined') window.addEventListener('resize', onResize)
      return () => {
        if (typeof window !== 'undefined') window.removeEventListener('resize', onResize)
        if (uplotRef.current && mountKeyRef.current === chartMountKey) {
          try { uplotRef.current.destroy() } catch {}
          uplotRef.current = null
        }
      }
    }, [cwd, chartMountKey, entries.length])

    // live data update via setData; keep instance
    React.useEffect(() => {
      if (paused) return
      const u = uplotRef.current
      if (!u || !u.setData) return
      try { if (Array.isArray(trendPayload.data)) u.setData(trendPayload.data) } catch {}
    })

    const agentAllowed = cvReady && configVersion > 0
    const sendTrend = (entry) => {
      if (!agentAllowed) {
        setCopied('no-version'); setTimeout(() => setCopied(''), 2000)
        return
      }
      const cv = configVersion
      const start = Date.now() - TREND_WINDOW_MS
      const end = Date.now()
      const key = entry ? entry.key : (entries[0] && entries[0].key) || ''
      if (!key) return
      const ref = buildAgentRef('trend', {
        trendKey: key,
        start,
        end,
        label: entry ? entry.label : 'trend-interval',
      }, { configVersion: cv, start, end })
      const res = dispatchAgentRef(ref, agentBridge) || { mode: 'copied' }
      const labelByMode = { input: '已加入输入框', sent: '已发送', copied: '仅复制', failed: '处理失败' }
      setCopied((entry ? entry.key : 'trend') + ':' + (labelByMode[res.mode] || '仅复制'))
      setTimeout(() => setCopied(''), 2000)
      if (post && cwd) {
        // Task4/0.18.2: typed evidence back-mount — failures surface CONFIG_DRIFT/TARGET_MISMATCH
        // Task6/0.18.2: on drift, re-pull current state so the reference uses the new version
        try { postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
          setEvNote(reason)
          setTimeout(() => setEvNote(''), 5000)
          if (/CONFIG_DRIFT/.test(reason)) {
            post('/dsh-vision-bench/state', { cwd }).then(applyCv).catch(() => {})
          }
        }) } catch {}
      }
    }
    const focusTrend = (entry) => {
      if (!cwd || !post) return
      const key = entry ? entry.key : (entries[0] && entries[0].key) || ''
      post('/dsh-vision-bench/focus', { cwd, target: { trendKey: key, kind: 'trend' } }).catch(() => {})
    }
    const doExport = () => {
      const w = wrapRef.current, s = w && w._uplotSel
      const start = s ? s.start : (Date.now() - TREND_WINDOW_MS)
      const end = s ? s.end : Date.now()
      const trend = (mbStore && mbStore.trend) || {}
      const lines = ['time,point,name,unit,value']
      const pts = (() => { try { return normalizeModbus(mbStore).points || [] } catch { return [] } })()
      for (const pt of pts.filter((p) => p.trendEnabled === true).slice(0, 8)) {
        const list = Array.isArray(trend[pt.id]) ? trend[pt.id] : []
        for (const sv of list) {
          if (!Array.isArray(sv) || sv[0] < start || sv[0] > end) continue
          lines.push([sv[0], pt.id, (pt.name || String(pt.address)).replace(/,/g, '，'), pt.unit || '', sv[1] == null ? '' : sv[1]].join(','))
        }
      }
      try { if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(lines.join('\n')) } catch {}
      setExportNote(s ? '已导出区间 ' + new Date(start).toLocaleTimeString() + '→' + new Date(end).toLocaleTimeString() : '已导出最近 5 分钟')
      setTimeout(() => setExportNote(''), 2000)
    }
    const resetZoom = () => {
      const w = wrapRef.current; if (w) w._uplotSel = null
      const u = uplotRef.current
      if (u && u.setSelect) try { u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false) } catch {}
      if (u && u.setData) try { if (Array.isArray(trendPayload.data)) u.setData(trendPayload.data) } catch {}
    }
    return el('div', { className: 'dvb-live' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveChart')),
        el('span', { className: 'dvb-map-meta' }, t('chartWindow')),
        entries.length ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm' + (paused ? ' is-on' : ''), onClick() { setPaused((v) => !v) } }, paused ? '恢复' : '暂停') : null,
        entries.length ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: doExport }, '导出CSV') : null,
        entries.length ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: resetZoom }, '重置缩放') : null,
        entries.length ? el('button', {
          type: 'button', className: 'dvb-btn dvb-btn-sm' + (agentAllowed ? '' : ' is-on'),
          title: agentAllowed ? '复制趋势区间结构化引用（稳定 ID+配置版本+时间范围）让 Agent 分析' : '配置版本未就绪，无法生成引用',
          disabled: !agentAllowed,
          onClick() { sendTrend(null) },
        }, copied.split(':')[1] === '已加入输入框' ? '已加入' : (copied.split(':')[1] === '已发送' ? '已发送' : '让 Agent 分析区间')) : null,
        entries.length ? el('button', {
          type: 'button', className: 'dvb-btn dvb-btn-sm',
          onClick() { focusTrend(null) },
        }, '聚焦区间') : null),
      copied ? el('div', { className: 'dvb-hint' }, (copied === 'no-version' ? '配置版本未就绪，无法生成证据引用' : (copied.split(':')[1] || '')) + ' · ' + (copied === 'no-version' ? '' : copied.split(':')[0])) : null,
      exportNote ? el('div', { className: 'dvb-hint' }, exportNote) : null,
      evNote ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, evNote) : null,
      entries.length
        ? el('div', { ref: wrapRef, className: 'dvb-uplot', style: { width: '100%', height: '190px' } })
        : el('div', { className: 'dvb-empty' },
            el('div', null, t('trendEmptyPoint') || '暂无曲线点位'),
            el('div', { className: 'dvb-hint' }, t('trendEmptyHint') || '请在上位机的点位配置中勾选“加入曲线”')),
      entries.length
        ? el('div', { className: 'dvb-trend-legend' }, entries.map((item) => el('div', { key: item.key, className: 'dvb-trend-row' },
          el('span', { className: 'dvb-trend-dot', style: { background: item.color } }),
          el('span', { className: 'dvb-trend-name', title: item.label }, item.label),
          el('span', { className: 'dvb-val' }, item.last != null && Number.isFinite(item.last.v) ? String(item.last.v) + (item.unit ? ' ' + item.unit : '') : '—'),
          el('span', { className: 'dvb-map-meta' }, (item.lastValid ? ('min ' + item.min + ' · max ' + item.max) : '无有效数据')),
          el('button', {
            type: 'button', className: 'dvb-btn dvb-btn-sm' + (agentAllowed ? '' : ' is-on'), disabled: !agentAllowed,
            title: agentAllowed ? '让 Agent 分析此曲线区间' : '配置版本未就绪',
            onClick() { sendTrend(item) },
          }, copied === item.key + ':已加入输入框' ? '已加入' : (copied === item.key + ':已发送' ? '已发送' : '让 Agent 分析')),
          el('span', { className: 'dvb-hint' }, item.key))))        : null)
  }
}

export function createAlarmPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  const openLive = hooks && hooks.openHmi
  return function AlarmPage(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    // Task5/0.18.2: hook reads at render top-level, passed into the pure dispatch bridge
    const inputDraft = readInputDraft(props && props.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const [events, setEvents] = React.useState([])
    const [alarmState, setAlarmState] = React.useState({})
    const [pack, setPack] = React.useState(null)
    const [view, setView] = React.useState('activeUnacked')
    const [group, setGroup] = React.useState('all')
    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (!data) return
      const timeline = data.journal && Array.isArray(data.journal.timeline) ? data.journal.timeline : []
      setEvents(timeline.filter((item) => item.kind === 'alarm' || item.kind === 'alarm-clear'))
      const mb = data.workspace && data.workspace.modbus
      if (mb) { setAlarmState(mb.alarmState || mb.alarmActive || {}); try { setPack(normalizeModbus(mb)) } catch { setPack(null) } }
    }), [cwd, post])
    const grouped = groupAlarms(alarmState)
    const bucketMap = grouped.buckets || { activeUnacked: grouped.activeUnacked || [], activeAcked: grouped.activeAcked || [], recoveredUnacked: grouped.recoveredUnacked || [], recoveredAcked: grouped.recoveredAcked || [] }
    const legacyMap = { current: grouped.current, history: grouped.history }
    const list = bucketMap[view] || legacyMap[view] || grouped.current || []
    const filtered = group === 'all' ? list : list.filter(a=> a.group===group)
    // enrich with point/connection/device labels
    const [copiedAlarm, setCopiedAlarm] = React.useState('')
    const [evNote, setEvNote] = React.useState('')
    const enriched = filtered.map(a=>{
      const pt = pack && a.pointId ? (pack.points||[]).find(p=> p.id===a.pointId) : null
      const conn = pack && a.connectionId ? (pack.connections||[]).find(c=> c.id===a.connectionId) : null
      const dev = pack && a.deviceId ? (pack.devices||[]).find(d=> d.id===a.deviceId) : null
      const threshold = a.threshold != null ? a.threshold : (pt ? (a.kind==='max'? pt.alarmMax : pt.alarmMin) : null)
      const label = pt ? (pt.name || a.pointId) : (a.label || a.connectionId || a.id)
      return { a, pt, conn, dev, threshold, label }
    }).sort((x,y)=> (y.a.lastAt||0)-(x.a.lastAt||0))
    const doAck = (id)=>{
      const next = acknowledgeAlarm(alarmState, id, { by: 'user' })
      if (next && next._suggested) return
      setAlarmState(next)
      if (cwd) post('/dsh-vision-bench/workspace', { cwd, modbus:{ alarmState: next, version:3 } }).catch(()=>{})
    }
    const sendToAgentAlarm = (row)=>{
      const cv = pack ? (pack.configVersion || 1) : 1
      const ref = buildAgentRef('alarm', {
        alarmId: row.a.id,
        connectionId: row.a.connectionId,
        deviceId: row.a.deviceId,
        pointId: row.a.pointId,
        label: row.label,
        start: row.a.firstAt || row.a.lastAt,
        end: row.a.lastAt,
      }, { configVersion: cv, start: row.a.firstAt || row.a.lastAt, end: row.a.lastAt })
      const res = dispatchAgentRef(ref, agentBridge)
      // Task5/0.18.2: unified status enum input|sent|copied|failed — surface it on screen
      setCopiedAlarm(row.a.id + ':' + res.status)
      setTimeout(()=> setCopiedAlarm(''), 2000)
      if (cwd) {
        // Task4/0.18.2: typed evidence back-mount — failures surface CONFIG_DRIFT/TARGET_MISMATCH
        try { postEvidence(post, cwd, evidenceFromRef(ref), (reason) => { setEvNote(reason); setTimeout(() => setEvNote(''), 4000) }) } catch {}
      }
    }
    const focusAlarm = (row)=>{
      if (!cwd) return
      post('/dsh-vision-bench/focus', { cwd, target: { alarmId: row.a.id, connectionId: row.a.connectionId, deviceId: row.a.deviceId, pointId: row.a.pointId, kind: 'alarm' } }).catch(()=>{})
    }
    const jumpPoint = (row)=>{ if (typeof openHmi==='function' && row.pt) try{ openHmi({ connectionId: row.a.connectionId, deviceId: row.a.deviceId, pointId: row.a.pointId }) }catch{} }
    const jumpChart = ()=>{ if (typeof openLive==='function') try{ openLive() }catch{} }
    const jumpFrames = (row)=>{ if (typeof openLive==='function') try{ openLive() }catch{} }
    return el('div', { className: 'dvb-live' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveAlarm')),
        el('span', { className: 'dvb-chip', 'data-kind': (grouped.activeAll && grouped.activeAll.length) || grouped.active.length?'err':'ready' }, ((grouped.activeAll && grouped.activeAll.length) || grouped.active.length)+' 激活')),
      el('div', { className: 'dvb-toolbar' },
        el('button', { type:'button', className:'dvb-btn'+(view==='activeUnacked'?' is-on':''), onClick(){ setView('activeUnacked') } }, '激活未确认'+(grouped.buckets? '·'+grouped.buckets.activeUnacked.length:'')),
        el('button', { type:'button', className:'dvb-btn'+(view==='activeAcked'?' is-on':''), onClick(){ setView('activeAcked') } }, '激活已确认'+(grouped.buckets? '·'+grouped.buckets.activeAcked.length:'')),
        el('button', { type:'button', className:'dvb-btn'+(view==='recoveredUnacked'?' is-on':''), onClick(){ setView('recoveredUnacked') } }, '已恢复未确认'+(grouped.buckets? '·'+grouped.buckets.recoveredUnacked.length:'')),
        el('button', { type:'button', className:'dvb-btn'+(view==='recoveredAcked'?' is-on':''), onClick(){ setView('recoveredAcked') } }, '已恢复已确认·历史'+(grouped.buckets? '·'+grouped.buckets.recoveredAcked.length:'')),
        el('span', { style:{width:'8px', display:'inline-block'}}),
        el('button', { type:'button', className:'dvb-btn'+(group==='all'?' is-on':''), onClick(){ setGroup('all') } }, '全部'),
        el('button', { type:'button', className:'dvb-btn'+(group===PROCESS?' is-on':''), onClick(){ setGroup(PROCESS) } }, '过程'),
        el('button', { type:'button', className:'dvb-btn'+(group===COMM?' is-on':''), onClick(){ setGroup(COMM) } }, '通信'),
        enriched.length ? el('button', { type:'button', className:'dvb-btn', onClick(){ doAck('all') } }, '全部确认') : null),
      (copiedAlarm || evNote) ? el('div', { className: 'dvb-hint' + (evNote ? ' dvb-err' : ''), 'data-kind': evNote ? 'err' : undefined }, evNote || (copiedAlarm.split(':').pop() + ' · ' + copiedAlarm.split(':')[0]) ) : null,
      enriched.length
        ? el('div', { className: 'dvb-live-list' }, enriched.slice(0,80).map((row)=> {
            const condLabel = row.a.condition===COND_ACTIVE ? (row.a.acknowledged ? '激活已确认' : '激活未确认') : (row.a.acknowledged ? '已恢复已确认' : '已恢复未确认')
            const ackInfo = row.a.acknowledged ? ('已确认·'+(row.a.ackedBy||'user')+'@'+clockOf(row.a.ackedAt)) : (row.a.suggestedBy ? '建议·'+row.a.suggestedBy : '未确认')
            const dur = row.a.durationMs ? (Math.round(row.a.durationMs/1000)+'s') : (row.a.recoveredAt ? Math.round((row.a.recoveredAt - row.a.firstAt)/1000)+'s' : '')
            return el('div', { key: row.a.id, className: 'dvb-task', 'data-status': row.a.status, 'data-condition': row.a.condition, 'data-acked': row.a.acknowledged?'true':'false', 'data-group': row.a.group },
            el('span', { className: 'dvb-badge', 'data-status': row.a.status, 'data-condition': row.a.condition }, condLabel),
            el('span', { className: 'dvb-badge', 'data-group': row.a.group }, row.a.group===COMM?'通信':'过程'),
            el('span', { className: 'dvb-badge', 'data-severity': row.a.severity || 'medium' }, row.a.severity || ''),
            el('span', { className: 'dvb-map-meta' }, clockOf(row.a.lastAt)),
            el('span', { className: 'dvb-hint', title: row.a.id }, row.label),
            row.conn ? el('span', { className: 'dvb-hint' }, row.conn.name) : null,
            row.dev ? el('span', { className: 'dvb-hint' }, row.dev.name + '·Unit '+row.dev.unitId) : null,
            el('span', { className: 'dvb-hint' }, row.a.threshold!=null?'阈值 '+row.a.threshold:''),
            el('span', { className: 'dvb-hint' }, row.a.value!=null?'当前 '+row.a.value:''),
            el('span', { className: 'dvb-badge', 'data-quality': row.a.quality || 'good' }, row.a.quality || 'good'),
            row.a.count>1 ? el('span', { className: 'dvb-tag' }, '×'+row.a.count) : null,
            dur ? el('span', { className: 'dvb-tag' }, '持续'+dur) : null,
            el('span', { className: 'dvb-hint' }, ackInfo),
            row.a.frameId ? el('span', { className: 'dvb-hint', title: row.a.frameId }, '帧:'+row.a.frameId.slice(0,8)) : null,
            !row.a.acknowledged ? el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ doAck(row.a.id) } }, '确认') : null,
            el('button', {
              type:'button', className:'dvb-btn dvb-btn-sm',
              title: '复制告警结构化引用（稳定 ID+配置版本+时间范围，含 point/connection/device/frame/transaction/task）',
              onClick(){ sendToAgentAlarm(row) },
            }, copiedAlarm===row.a.id ? '已复制' : '让 Agent 分析'),
            row.pt ? el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ jumpPoint(row) } }, '点位') : null,
            el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick: jumpChart }, '曲线'),
            el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ jumpFrames(row) } }, '报文')
          )}))
        : el('div', { className: 'dvb-hint' }, t('alarmEmpty')),
      events.length ? el('div', { className: 'dvb-hint', style:{marginTop:'8px'} }, '历史事件 '+events.length) : null,
      events.length ? el('div', { className: 'dvb-live-list' }, events.slice(0,6).map((item)=> el('div', { key:item.id, className:'dvb-task', 'data-ok': item.ok?'true':'false' }, el('span', { className:'dvb-map-meta' }, clockOf(item.at)), el('span', { className:'dvb-badge', 'data-source':item.source }, item.source), el('span', { className:'dvb-hint' }, item.summary)))) : null)
  }
}

// ── 操作记录（Task9/0.19.2）──────────────────────────────────────────────
// 时间线从"调试/上位机"移入侧边栏：筛选 + 每行 跳转/复制给Agent/查看报文。
export function createLogPage(React, t, post, helpers = {}) {
  const el = React.createElement
  const FILTERS = [
    { key: 'all', label: t('logFilterAll') || '全部' },
    { key: 'user', label: t('logFilterUser') || '用户' },
    { key: 'agent', label: t('logFilterAgent') || 'Agent' },
    { key: 'system', label: t('logFilterSystem') || '系统' },
    { key: 'err', label: t('logFilterErr') || '错误' },
  ]
  return function LogPage(props) {
    const cwd = (props && props.scope && props.scope.cwd) || props && props.cwd || ''
    const [journal, setJournal] = React.useState({ tasks: [], running: [], timeline: [] })
    const [filter, setFilter] = React.useState('all')
    const [note, setNote] = React.useState('')
    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (data && data.journal) setJournal(data.journal)
    }), [cwd, post])
    const tasks = journal && Array.isArray(journal.tasks) ? journal.tasks : []
    const timeline = journal && Array.isArray(journal.timeline) ? journal.timeline : []
    const running = journal && Array.isArray(journal.running) ? journal.running : []
    const filtered = timeline.filter((item) => {
      if (filter === 'err') return item.ok === false || item.kind === 'error' || String(item.summary || '').indexOf('异常') >= 0
      if (filter === 'all') return true
      return (item.source || 'system') === filter
    })
    const jump = (item) => {
      const target = item && (item.pointId ? { connectionId: item.connectionId, deviceId: item.deviceId, pointId: item.pointId } : item && item.deviceId ? { connectionId: item.connectionId, deviceId: item.deviceId } : item && item.connectionId ? { connectionId: item.connectionId } : {})
      if (helpers && typeof helpers.openHmi === 'function') { try { helpers.openHmi(target) } catch {} return }
    }
    const copyLine = (item) => {
      const line = '[' + String(item.source || 'system') + '] ' + clockOf(item.at) + ' ' + (item.summary || item.kind || item.id)
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(line).then(() => setNote('已复制: ' + (item.summary || item.kind)), () => setNote('复制失败'))
        } else { setNote('复制失败（无剪贴板）') }
      } catch { setNote('复制失败') }
    }
    const viewFrames = (item) => { if (helpers && typeof helpers.openFrames === 'function') { try { helpers.openFrames() } catch {} } }
    return el('div', { className: 'dvb-page' },
      el('div', { className: 'dvb-toolbar', style: { flexWrap: 'wrap' } },
        FILTERS.map((f) => el('button', {
          key: f.key,
          type: 'button',
          className: 'dvb-btn dvb-btn-sm' + (filter === f.key ? ' dvb-btn-primary' : ''),
          onClick() { setFilter(f.key) },
        }, f.label)),
        running.length ? el('span', { className: 'dvb-tag' }, '运行中 ' + running.length) : null,
        el('span', { className: 'dvb-hint' }, '共 ' + filtered.length + ' 条')),
      tasks.length ? el('div', { className: 'dvb-journal' },
        el('div', { className: 'dvb-journal-title' }, t('tasks') || '任务'),
        tasks.slice(0, 6).map((item) => el('div', { key: item.id, className: 'dvb-task', 'data-status': item.status, 'data-source': item.source },
          el('span', { className: 'dvb-badge' }, clockOf(item.startedAt)),
          el('span', { className: 'dvb-badge', 'data-source': item.source }, String(item.source || '')),
          el('span', null, item.summary || String(item.type || '任务')),
          item.status ? el('span', { className: 'dvb-badge' }, String(item.status)) : null))) : null,
      filtered.length ? el('div', { className: 'dvb-journal' },
        el('div', { className: 'dvb-journal-title' }, t('liveLog') || '操作记录'),
        filtered.slice(-200).reverse().map((item) => el('div', {
          key: item.id,
          className: 'dvb-event',
          'data-source': item.source,
          'data-ok': item.ok === false ? 'false' : item.ok === true ? 'true' : '',
        },
          el('span', { className: 'dvb-badge' }, clockOf(item.at)),
          el('span', { className: 'dvb-badge', 'data-source': item.source }, String(item.source || 'system')),
          el('span', { className: 'dvb-hint', title: item.kind + (item.taskId ? ' · ' + item.taskId : '') }, item.summary || item.kind || item.id),
          item.pointId || item.connectionId ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', title: '跳转到目标', onClick() { jump(item) } }, t('logJump') || '跳转') : null,
          el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', title: '复制给 Agent', onClick() { copyLine(item) } }, t('logCopyAgent') || '复制'),
          item.frameId ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { viewFrames(item) } }, t('logViewFrames') || '报文') : null))) : null,
      note ? el('div', { className: 'dvb-hint' }, note) : null)
  }
}

export function registerLive(ctx, React, t, LivePage, pages = {}) {
  // Task2/0.19.3: 监视 Tab 已删除 — 采集由 Host 后台服务（/polling/*）运行；
  // 侧边栏只保留 曲线/告警/串口报文/操作记录。
  void LivePage
  const bs = ctx.betterSidebar
  const TrendPage = pages.trend || createSoonPage(React, t, 'liveChart', 'chartSoon')
  const AlarmPage = pages.alarm || createSoonPage(React, t, 'liveAlarm', 'alarmSoon')
  const FramesPage = pages.frames || createSoonPage(React, t, 'framesTab', 'framesEmpty')
  const LogPage = pages.log || createLogPage(React, t)
  const stops = [
    bs.registerTab({
      id: TAB_CHART,
      title() { return t('liveChart') },
      single: true,
      order: 71,
      component: TrendPage,
    }),
    bs.registerTab({
      id: TAB_ALARM,
      title() { return t('liveAlarm') },
      single: true,
      order: 72,
      component: AlarmPage,
    }),
    bs.registerTab({
      id: TAB_FRAMES,
      title() { return t('framesTab') },
      single: true,
      order: 73,
      component: FramesPage,
    }),
    bs.registerTab({
      id: TAB_LOG,
      title() { return t('liveLog') },
      single: true,
      order: 74,
      component: LogPage,
    }),
  ]
  return function () {
    for (const stop of stops) {
      if (typeof stop === 'function') stop()
    }
  }
}

export function closeBetterTab(ctx, tabId) {
  const bs = getBetterSidebar(ctx)
  if (bs && typeof bs.closeTab === 'function') bs.closeTab(tabId)
}

export const _internal = { TAB_TABLE, TAB_CHART, TAB_ALARM, TAB_FRAMES, getBetterSidebar }
