import { pushFramesLog, subscribeState, getFramesLog, clearFramesLog, resolveSidebarScope, getSidebarPin, setSidebarPin } from './bench-shared.mjs'
import { clockOf, decodeValue, functionTag } from './bench-points.mjs'
import { NS } from './bench-i18n.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { TREND, TREND_CAP, TREND_WINDOW_MS, trendKey, sampleTrend } from './bench-trend.mjs'
import { normalizeAlarmState, groupAlarms, acknowledgeAlarm, ACTIVE, RECOVERED, ACKED, PROCESS, COMM } from './bench-alarm.mjs'

const TAB_TABLE = 'dsh-vision-bench:modbus'
const TAB_CHART = 'dsh-vision-bench:charts'
const TAB_ALARM = 'dsh-vision-bench:alarms'
const TAB_FRAMES = 'dsh-vision-bench:frames'
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

function healthReady(health) {
  return !!(health && health.python && health.python.bound && health.python.exists)
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

export function createLiveView(React, t, post, hooks) {
  const openLive = hooks && hooks.openLive
  const openHmi = hooks && hooks.openHmi
  const closeTab = hooks && hooks.closeTab
  return function LiveView(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const [health, setHealth] = React.useState({})
    const [modbus, setModbus] = React.useState({ version: 3, connections: [], devices: [], points: [], values: [], pollingByConnection: {} })
    const [tickError, setTickError] = React.useState('')
    const [search, setSearch] = React.useState('')
    const [pinnedTick, setPinnedTick] = React.useState(0)
    const [paused, setPaused] = React.useState(false)

    React.useEffect(() => {
      let stop = false
      let timer = 0
      function wait(ms) { return new Promise((resolve) => { timer = setTimeout(resolve, ms) }) }
      async function loop() {
        while (!stop) {
          if (!cwd) {
            setModbus({ version: 3, connections: [], devices: [], points: [], values: [], pollingByConnection: {} })
            await wait(2000)
            continue
          }
          if (paused) { await wait(2000); continue }
          try {
            const data = await post('/dsh-vision-bench/state', { cwd })
            if (stop) return
            if (data && data.health) setHealth(data.health)
            const next = data && data.workspace && data.workspace.modbus
            if (next) {
              setModbus(next)
              sampleTrend(cwd, next)
            }
            const packTmp = next ? normalizeModbus(next) : null
            const activeCid = packTmp ? packTmp.activeConnectionId : null
            const hasPoints = packTmp && Array.isArray(packTmp.points) && packTmp.points.length > 0
            const pollingForActive = packTmp && activeCid ? (packTmp.pollingByConnection && packTmp.pollingByConnection[activeCid]) : null
            const enabled = pollingForActive ? pollingForActive.enabled : (next && next.polling && next.polling.enabled)
            const interval = pollingForActive ? pollingForActive.intervalMs : (next && next.polling && next.polling.intervalMs) || 1000
            const canPoll = enabled && hasPoints && (healthReady(data && data.health) || (next && (next.conn && next.conn.sim)))
            if (canPoll) {
              // poll only the scoped connection (follow or pinned)
              const scope = resolveSidebarScope(cwd, packTmp.activeConnectionId, packTmp.activeDeviceId)
              const pollCid = scope.connectionId || activeCid
              const polled = await post('/dsh-vision-bench/modbus/poll', pollCid ? { cwd, connectionId: pollCid } : { cwd }, 120000)
              if (stop) return
              if (polled && Array.isArray(polled.values)) {
                setModbus((prev) => ({ ...prev, values: polled.values, pollingByConnection: polled.pollingByConnection || prev.pollingByConnection, polling: polled.polling || prev.polling }))
              }
              if (polled && Array.isArray(polled.framesLog)) {
                const cid = pollCid || '_default'
                pushFramesLog(cwd, cid, polled.framesLog)
              }
              setTickError(polled && polled.ok === false && !polled.skipped ? (polled.error || t('fail')) : '')
              await wait(Math.max(200, Number(interval) || 1000))
            } else {
              if (!enabled) setTickError('')
              await wait(enabled ? 2000 : 2000)
            }
          } catch (err) {
            if (stop) return
            setTickError(String((err && err.message) || t('fail')))
            await wait(2000)
          }
        }
      }
      loop()
      return () => { stop = true; clearTimeout(timer) }
    }, [cwd, paused])

    function persistPolling(patch) {
      if (!cwd) return
      const pack = normalizeModbus(modbus)
      const scope = resolveSidebarScope(cwd, pack.activeConnectionId, pack.activeDeviceId)
      const targetCid = scope.connectionId || pack.activeConnectionId
      if (!targetCid) return
      const nextPolling = { ...(pack.pollingByConnection || {}) }
      nextPolling[targetCid] = { ...(nextPolling[targetCid] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }), ...patch }
      const next = { ...pack, pollingByConnection: nextPolling }
      // optimistic
      setModbus(next)
      if (patch.enabled && typeof openLive === 'function') openLive()
      post('/dsh-vision-bench/workspace', { cwd, modbus: { pollingByConnection: nextPolling, version: 3 } }).catch(() => {})
    }

    const pack = normalizeModbus(modbus)
    const scope = resolveSidebarScope(cwd, pack.activeConnectionId, pack.activeDeviceId)
    // keep pinnedTick to force re-render on pin change
    void pinnedTick
    const activeConn = pack.connections.find((c) => c.id === scope.connectionId) || pack.connections.find((c) => c.id === pack.activeConnectionId) || pack.connections[0] || null
    const activeDev = pack.devices.find((d) => d.id === scope.deviceId) || pack.devices.find((d) => d.connectionId === (activeConn && activeConn.id)) || pack.devices[0] || null
    const pollingForScope = scope.connectionId ? (pack.pollingByConnection && pack.pollingByConnection[scope.connectionId]) : null
    const polling = pollingForScope || pack.polling || { enabled: false, intervalMs: 1000 }
    const enabled = polling.enabled === true
    const pythonReady = healthReady(health)
    const sim = activeConn ? (activeConn.conn && activeConn.conn.sim === true) : false
    const canWatch = pythonReady || sim
    const points = Array.isArray(pack.points) ? pack.points : []
    // v3 scope filtering: must match connectionId and optionally deviceId
    const scopedPoints = points.filter((p) => {
      if (scope.connectionId && (p.connectionId || p.connId) !== scope.connectionId) return false
      if (scope.deviceId && scope.pinned && p.deviceId !== scope.deviceId) return false
      return true
    })
    const valueMap = {}
    for (const item of Array.isArray(pack.values) ? pack.values : []) {
      const pid = item && (item.pointId || item.key)
      if (pid) valueMap[pid] = item
    }
    const needle = search.trim().toLowerCase()
    const rows = scopedPoints.filter((p) => {
      if (!needle) return true
      const name = (p.name || (functionTag(p.function) + p.address)).toLowerCase()
      return name.includes(needle) || String(p.address).includes(needle) || String(p.id).toLowerCase().includes(needle)
    }).map((point) => {
      const rec = valueMap[point.id]
      let shown = '—'
      let quality = 'good'
      let rawText = ''
      let engText = ''
      if (rec) {
        if (rec.ok === false) {
          shown = rec.error || '—'
          quality = 'bad'
        } else if (rec.raw !== null && rec.raw !== undefined) {
          const rawVal = rec.raw
          const engVal = decodeValue(point, typeof rawVal === 'boolean' ? (rawVal ? 1 : 0) : rawVal)
          rawText = String(rawVal)
          engText = String(engVal) + (point.unit ? ' ' + point.unit : '')
          shown = engText
          quality = 'good'
        } else {
          quality = 'stale'
        }
      } else {
        quality = 'stale'
      }
      // stale / timeout / disconnected not green
      const at = rec && rec.at ? clockOf(rec.at) : ''
      return {
        key: point.id,
        point,
        rec,
        name: point.name || (functionTag(point.function) + point.address),
        shown,
        rawText,
        engText,
        quality,
        at,
        ok: !rec || rec.ok !== false ? true : false,
        connectionId: point.connectionId || point.connId || '',
        deviceId: point.deviceId || '',
      }
    })
    const kind = !cwd || !scopedPoints.length || !canWatch
      ? 'idle'
      : (tickError || polling.lastOk === false ? 'err' : (enabled ? 'live' : 'idle'))
    const tabId = props && props.tab && props.tab.id
    const togglePin = () => {
      if (scope.pinned) {
        setSidebarPin(cwd, null)
      } else {
        setSidebarPin(cwd, { connectionId: scope.connectionId, deviceId: scope.deviceId, pinned: true })
      }
      setPinnedTick((n) => n + 1)
    }
    const openInHmi = () => {
      if (typeof openHmi === 'function') {
        try { openHmi({ connectionId: scope.connectionId, deviceId: scope.deviceId }) } catch {}
        return
      }
      if (typeof openLive === 'function') {
        try { openLive() } catch {}
      }
    }
    const scopeLabel = () => {
      if (!cwd) return t('needWorkspace')
      const connName = activeConn ? activeConn.name : (scope.connectionId || '—')
      const connEp = activeConn && activeConn.conn ? (activeConn.conn.mode === 'tcp' ? ((activeConn.conn.host || 'TCP') + ':' + (activeConn.conn.tcpPort || 502)) : (activeConn.conn.port || '—')) : '—'
      const devName = activeDev ? (activeDev.name + ' · Unit ' + activeDev.unitId) : (scope.deviceId || '—')
      return connName + ' · ' + connEp + ' / ' + devName
    }

    return el('div', { className: 'dvb-live', 'data-kind': kind },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveTable')),
        el('span', { className: 'dvb-live-dot', 'data-kind': kind })),
      // unified scope bar
      el('div', { className: 'dvb-scope-bar' },
        el('span', { className: 'dvb-scope-cwd', title: cwd || '' }, cwd ? cwd.slice(-32) : t('needWorkspace')),
        el('span', { className: 'dvb-scope-conn', title: scopeLabel() }, scopeLabel()),
        el('span', { className: 'dvb-chip', 'data-kind': scope.pinned ? 'warn' : 'ready' }, scope.pinned ? t('scopePinned') : t('scopeFollow')),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: togglePin }, scope.pinned ? t('scopeFollow') : t('scopePinned')),
        el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: openInHmi }, t('openInHmi')),
        tabId && typeof closeTab === 'function'
          ? el('button', { type: 'button', className: 'dvb-btn dvb-live-close', title: t('liveClose'), onClick() { closeTab(tabId) } }, '×')
          : null),
      el('div', { className: 'dvb-live-controls' },
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (enabled ? ' dvb-btn-primary' : ''),
          disabled: !cwd || !canWatch || !scopedPoints.length,
          onClick() { persistPolling({ enabled: !enabled }) },
        }, enabled ? t('liveStop') : t('liveStart')),
        el('select', {
          className: 'dvb-input dvb-live-interval',
          value: String(polling.intervalMs || 1000),
          disabled: !cwd,
          onChange(event) { persistPolling({ intervalMs: Number(event.target.value) }) },
        }, INTERVALS.map((ms) => el('option', { key: String(ms), value: String(ms) }, (ms / 1000) + 's'))),
        el('button', {
          type: 'button',
          className: 'dvb-btn',
          disabled: !cwd,
          title: paused ? '恢复' : '暂停',
          onClick() { setPaused((v) => !v) },
        }, paused ? '恢复' : '暂停')),
      el('div', { className: 'dvb-live-search' },
        el('input', {
          className: 'dvb-input',
          value: search,
          placeholder: t('monitorSearch'),
          spellCheck: false,
          onChange(event) { setSearch(event.target.value) },
        })),
      !cwd
        ? el('div', { className: 'dvb-hint' }, t('needWorkspace'))
        : (!canWatch
          ? el('div', { className: 'dvb-need' }, t('needBindingsRead'))
          : (!scopedPoints.length
            ? el('div', { className: 'dvb-hint' }, t('monitorEmpty'))
            : (sim ? el('div', { className: 'dvb-hint' }, t('simHint')) : null))),
      tickError ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, tickError) : null,
      rows.length
        ? el('div', { className: 'dvb-live-list' }, rows.map((row) => {
          return el('div', {
            key: row.key,
            className: 'dvb-live-row',
            'data-ok': row.ok ? 'true' : 'false',
            'data-quality': row.quality,
            'data-connection': row.connectionId,
            'data-device': row.deviceId,
          },
            el('span', { className: 'dvb-live-name', title: row.name + ' [' + row.connectionId + '/' + row.deviceId + ']' }, row.name),
            el('span', { className: 'dvb-val', title: row.rawText ? ('raw ' + row.rawText + ' → ' + row.engText) : row.shown }, row.shown),
            el('span', { className: 'dvb-map-meta', title: t('monitorTime') }, row.at || ''),
            el('span', { className: 'dvb-badge', 'data-quality': row.quality }, row.quality === 'good' ? '' : row.quality),
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              title: t('openInHmi'),
              onClick() {
                if (typeof openHmi === 'function') {
                  try { openHmi({ connectionId: row.connectionId, deviceId: row.deviceId, pointId: row.key }) } catch {}
                } else if (typeof openLive === 'function') openLive()
              },
            }, t('openInHmi')))
        }))
        : null)
  }
}


function createSoonPage(React, t, titleKey, bodyKey) {
  return function SoonPage() {
    return React.createElement('div', { className: 'dvb-live' },
      React.createElement('div', { className: 'dvb-live-head' },
        React.createElement('span', { className: 'dvb-live-title' }, t(titleKey))),
      React.createElement('div', { className: 'dvb-hint' }, t(bodyKey)))
  }
}



export const drawTrend = (canvas, now = Date.now()) => {
  if (!canvas) return
  const ctx = canvas.getContext('2d')
  if (!ctx) return
  const w = canvas.width
  const h = canvas.height
  ctx.clearRect(0, 0, w, h)
  const cutoff = now - TREND_WINDOW_MS
  const series = []
  for (const [, list] of TREND.series) {
    const pts = list.filter((item) => item.t >= cutoff)
    if (pts.length >= 2) series.push(pts)
  }
  ctx.strokeStyle = 'rgba(128,128,128,.25)'
  ctx.lineWidth = 1
  for (let g = 1; g < 4; g++) {
    const y = (h / 4) * g
    ctx.beginPath()
    ctx.moveTo(0, y)
    ctx.lineTo(w, y)
    ctx.stroke()
  }
  if (!series.length) return
  let min = Infinity
  let max = -Infinity
  for (const pts of series) {
    for (const item of pts) {
      if (item.v < min) min = item.v
      if (item.v > max) max = item.v
    }
  }
  if (max === min) {
    max += 1
    min -= 1
  }
  const padY = (max - min) * 0.08
  min -= padY
  max += padY
  series.forEach((pts, i) => {
    ctx.strokeStyle = TREND_COLORS[i % TREND_COLORS.length]
    ctx.lineWidth = 1.5
    ctx.beginPath()
    pts.forEach((item, j) => {
      const x = ((item.t - cutoff) / TREND_WINDOW_MS) * w
      const y = h - ((item.v - min) / (max - min)) * h
      if (j === 0) ctx.moveTo(x, y)
      else ctx.lineTo(x, y)
    })
    ctx.stroke()
  })
}

export function createTrendPage(React, t) {
  return function TrendPage() {
    const el = React.createElement
    const canvasRef = React.useRef(null)
    const [, setTick] = React.useState(0)
    React.useEffect(() => {
      const timer = setInterval(() => setTick((n) => n + 1), 500)
      return () => clearInterval(timer)
    }, [])
    React.useEffect(() => {
      drawTrend(canvasRef.current)
    })
    const entries = []
    let i = 0
    for (const [key, list] of TREND.series) {
      if (!list.length) continue
      const window = list.filter((item) => item.t >= Date.now() - TREND_WINDOW_MS)
      if (!window.length) continue
      let min = window[0].v
      let max = window[0].v
      for (const item of window) {
        if (item.v < min) min = item.v
        if (item.v > max) max = item.v
      }
      entries.push({
        key,
        label: (TREND.meta.get(key) && TREND.meta.get(key).label) || key,
        unit: (TREND.meta.get(key) && TREND.meta.get(key).unit) || '',
        last: list[list.length - 1],
        min,
        max,
        color: TREND_COLORS[i % TREND_COLORS.length],
      })
      i++
      if (entries.length >= 8) break
    }
    return el('div', { className: 'dvb-live' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveChart')),
        el('span', { className: 'dvb-map-meta' }, t('chartWindow'))),
      entries.length
        ? el('canvas', { ref: canvasRef, className: 'dvb-trend-canvas', width: 560, height: 190 })
        : el('div', { className: 'dvb-hint' }, t('chartEmpty')),
      entries.length
        ? el('div', { className: 'dvb-trend-legend' }, entries.map((item) => el('div', { key: item.key, className: 'dvb-trend-row' },
          el('span', { className: 'dvb-trend-dot', style: { background: item.color } }),
          el('span', { className: 'dvb-trend-name', title: item.label }, item.label),
          el('span', { className: 'dvb-val' }, String(item.last.v) + (item.unit ? ' ' + item.unit : '')),
          el('span', { className: 'dvb-map-meta' }, 'min ' + item.min + ' · max ' + item.max))))
        : null)
  }
}

export function createAlarmPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  const openLive = hooks && hooks.openLive
  return function AlarmPage(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const [events, setEvents] = React.useState([])
    const [alarmState, setAlarmState] = React.useState({})
    const [pack, setPack] = React.useState(null)
    const [view, setView] = React.useState('current')
    const [group, setGroup] = React.useState('all')
    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (!data) return
      const timeline = data.journal && Array.isArray(data.journal.timeline) ? data.journal.timeline : []
      setEvents(timeline.filter((item) => item.kind === 'alarm' || item.kind === 'alarm-clear'))
      const mb = data.workspace && data.workspace.modbus
      if (mb) { setAlarmState(mb.alarmState || mb.alarmActive || {}); try { setPack(normalizeModbus(mb)) } catch { setPack(null) } }
    }), [cwd, post])
    const grouped = groupAlarms(alarmState)
    const list = view === 'current' ? grouped.current : grouped.history
    const filtered = group === 'all' ? list : list.filter(a=> a.group===group)
    // enrich with point/connection/device labels
    const enriched = filtered.map(a=>{
      const pt = pack && a.pointId ? (pack.points||[]).find(p=> p.id===a.pointId) : null
      const conn = pack && a.connectionId ? (pack.connections||[]).find(c=> c.id===a.connectionId) : null
      const dev = pack && a.deviceId ? (pack.devices||[]).find(d=> d.id===a.deviceId) : null
      const threshold = a.threshold != null ? a.threshold : (pt ? (a.kind==='max'? pt.alarmMax : pt.alarmMin) : null)
      const label = pt ? (pt.name || a.pointId) : (a.label || a.connectionId || a.id)
      return { a, pt, conn, dev, threshold, label }
    }).sort((x,y)=> (y.a.lastAt||0)-(x.a.lastAt||0))
    const doAck = (id)=>{
      const next = acknowledgeAlarm(alarmState, id)
      setAlarmState(next)
      if (cwd) post('/dsh-vision-bench/workspace', { cwd, modbus:{ alarmState: next, version:3 } }).catch(()=>{})
    }
    const jumpPoint = (row)=>{ if (typeof openHmi==='function' && row.pt) try{ openHmi({ connectionId: row.a.connectionId, deviceId: row.a.deviceId, pointId: row.a.pointId }) }catch{} }
    const jumpChart = ()=>{ if (typeof openLive==='function') try{ openLive() }catch{} }
    const jumpFrames = (row)=>{ if (typeof openLive==='function') try{ openLive() }catch{} }
    return el('div', { className: 'dvb-live' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveAlarm')),
        el('span', { className: 'dvb-chip', 'data-kind': grouped.active.length?'err':'ready' }, grouped.active.length+' 激活')),
      el('div', { className: 'dvb-toolbar' },
        el('button', { type:'button', className:'dvb-btn'+(view==='current'?' is-on':''), onClick(){ setView('current') } }, '当前'),
        el('button', { type:'button', className:'dvb-btn'+(view==='history'?' is-on':''), onClick(){ setView('history') } }, '历史'),
        el('button', { type:'button', className:'dvb-btn'+(group==='all'?' is-on':''), onClick(){ setGroup('all') } }, '全部'),
        el('button', { type:'button', className:'dvb-btn'+(group===PROCESS?' is-on':''), onClick(){ setGroup(PROCESS) } }, '过程'),
        el('button', { type:'button', className:'dvb-btn'+(group===COMM?' is-on':''), onClick(){ setGroup(COMM) } }, '通信'),
        enriched.length ? el('button', { type:'button', className:'dvb-btn', onClick(){ doAck('all') } }, '全部确认') : null),
      enriched.length
        ? el('div', { className: 'dvb-live-list' }, enriched.slice(0,80).map((row)=> el('div', { key: row.a.id, className: 'dvb-task', 'data-status': row.a.status, 'data-group': row.a.group },
            el('span', { className: 'dvb-badge', 'data-status': row.a.status }, row.a.status===ACTIVE?'激活': row.a.status===RECOVERED?'恢复':'已确认'),
            el('span', { className: 'dvb-badge', 'data-group': row.a.group }, row.a.group===COMM?'通信':'过程'),
            el('span', { className: 'dvb-map-meta' }, clockOf(row.a.lastAt)),
            el('span', { className: 'dvb-hint', title: row.a.id }, row.label),
            row.conn ? el('span', { className: 'dvb-hint' }, row.conn.name) : null,
            row.dev ? el('span', { className: 'dvb-hint' }, row.dev.name + '·Unit '+row.dev.unitId) : null,
            el('span', { className: 'dvb-hint' }, row.a.threshold!=null?'阈值 '+row.a.threshold:''),
            el('span', { className: 'dvb-hint' }, row.a.value!=null?'当前 '+row.a.value:''),
            el('span', { className: 'dvb-badge', 'data-quality': row.a.quality || 'good' }, row.a.quality || 'good'),
            row.a.count>1 ? el('span', { className: 'dvb-tag' }, '×'+row.a.count) : null,
            row.a.status!==ACKED ? el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ doAck(row.a.id) } }, '确认') : null,
            row.pt ? el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ jumpPoint(row) } }, '点位') : null,
            el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick: jumpChart }, '曲线'),
            el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ jumpFrames(row) } }, '报文')
          )))
        : el('div', { className: 'dvb-hint' }, t('alarmEmpty')),
      events.length ? el('div', { className: 'dvb-hint', style:{marginTop:'8px'} }, '历史事件 '+events.length) : null,
      events.length ? el('div', { className: 'dvb-live-list' }, events.slice(0,6).map((item)=> el('div', { key:item.id, className:'dvb-task', 'data-ok': item.ok?'true':'false' }, el('span', { className:'dvb-map-meta' }, clockOf(item.at)), el('span', { className:'dvb-badge', 'data-source':item.source }, item.source), el('span', { className:'dvb-hint' }, item.summary)))) : null)
  }
}

export function registerLive(ctx, React, t, LivePage, pages = {}) {
  const bs = ctx.betterSidebar
  const TrendPage = pages.trend || createSoonPage(React, t, 'liveChart', 'chartSoon')
  const AlarmPage = pages.alarm || createSoonPage(React, t, 'liveAlarm', 'alarmSoon')
  const stops = [
    bs.registerTab({
      id: TAB_TABLE,
      title() { return t('liveTable') },
      single: true,
      order: 70,
      component: LivePage,
    }),
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
  ]
  return function () {
    for (const stop of stops) {
      if (typeof stop === 'function') stop()
    }
  }
}

export function openModbusTab(ctx) {
  const bs = getBetterSidebar(ctx)
  if (bs && typeof bs.openTab === 'function') bs.openTab({ type: TAB_TABLE })
}

export function closeBetterTab(ctx, tabId) {
  const bs = getBetterSidebar(ctx)
  if (bs && typeof bs.closeTab === 'function') bs.closeTab(tabId)
}

export const _internal = { TAB_TABLE, TAB_CHART, TAB_ALARM, getBetterSidebar }
