import { clockOf, decodeValue, expandPoints, functionTag, isWritableFunction, normalizeWriteValues, writeTargetOf } from './bench-points.mjs'
import { NS } from './bench-i18n.mjs'
import { normalizeModbus } from './bench-devices.mjs'

const TAB_TABLE = 'dsh-vision-bench:modbus'
const TAB_CHART = 'dsh-vision-bench:charts'
const TAB_ALARM = 'dsh-vision-bench:alarms'
const INTERVALS = [500, 1000, 2000, 5000]
const TREND_CAP = 600
const TREND_WINDOW_MS = 5 * 60 * 1000

const TREND = { cwd: '', series: new Map(), meta: new Map() }

const trendKey = (deviceId, pointKey) => String(deviceId) + ':' + String(pointKey)

const sampleTrend = (cwd, pack) => {
  if (!cwd || TREND.cwd !== cwd) {
    if (TREND.cwd !== cwd) {
      TREND.cwd = cwd
      TREND.series.clear()
    }
    if (!cwd) return
  }
  const now = Date.now()
  const devices = Array.isArray(pack && pack.devices) ? pack.devices : []
  for (const device of devices) {
    const segById = {}
    for (const seg of Array.isArray(device.segments) ? device.segments : []) segById[seg.id] = seg
    for (const rec of Array.isArray(device.values) ? device.values : []) {
      if (!rec || !rec.key || rec.ok !== true || rec.value === null || rec.value === undefined) continue
      const seg = segById[rec.segmentId]
      const v = typeof rec.value === 'boolean' ? (rec.value ? 1 : 0) : Number(rec.value)
      if (!Number.isFinite(v)) continue
      const shown = seg ? decodeValue(seg, v) : v
      const key = trendKey(device.id, rec.key)
      TREND.meta.set(key, {
        label: (device.name ? device.name + ' / ' : '') + (rec.name || key),
        unit: seg ? seg.unit : '',
      })
      let list = TREND.series.get(key)
      if (!list) {
        list = []
        TREND.series.set(key, list)
      }
      list.push({ t: now, v: Number(shown) })
      if (list.length > TREND_CAP) list.splice(0, list.length - TREND_CAP)
    }
  }
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
  const closeTab = hooks && hooks.closeTab
  return function LiveView(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const [health, setHealth] = React.useState({})
    const [modbus, setModbus] = React.useState({ segments: [], values: [], polling: { enabled: false, intervalMs: 1000 } })
    const [tickError, setTickError] = React.useState('')
    const [edit, setEdit] = React.useState(null)

    React.useEffect(() => {
      let stop = false
      let timer = 0
      function wait(ms) {
        return new Promise((resolve) => { timer = setTimeout(resolve, ms) })
      }
      async function loop() {
        while (!stop) {
          if (!cwd) {
            setModbus({ segments: [], values: [], polling: { enabled: false, intervalMs: 1000 } })
            await wait(2000)
            continue
          }
          try {
            const data = await post('/dsh-vision-bench/state', { cwd })
            if (stop) return
            if (data && data.health) setHealth(data.health)
            const next = data && data.workspace && data.workspace.modbus
            if (next) setModbus(next)
            if (next) sampleTrend(cwd, next)
            const polling = (next && next.polling) || {}
            const enabled = polling.enabled === true
            const interval = Number(polling.intervalMs) > 0 ? Number(polling.intervalMs) : 1000
            const hasSegments = next && (
              (Array.isArray(next.devices) && next.devices.some((item) => item.segments && item.segments.length))
              || (Array.isArray(next.segments) && next.segments.length > 0)
            )
            if (enabled && hasSegments && (healthReady(data && data.health) || (next && next.sim))) {
              const polled = await post('/dsh-vision-bench/modbus/poll', { cwd }, 120000)
              if (stop) return
              if (polled && Array.isArray(polled.values)) {
                setModbus((prev) => ({ ...prev, values: polled.values, polling: polled.polling || prev.polling }))
              }
              setTickError(polled && polled.ok === false && !polled.skipped ? (polled.error || t('fail')) : '')
              await wait(interval)
            } else {
              if (!enabled) setTickError('')
              await wait(enabled ? interval : 2000)
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
    }, [cwd])

    function persistPolling(patch) {
      if (!cwd) return
      const pack = normalizeModbus(modbus)
      const devices = pack.devices.map((item) => (
        item.role === 'slave'
          ? item
          : { ...item, polling: { ...item.polling, ...patch } }
      ))
      const polling = { ...(pack.polling || {}), ...patch }
      const next = { ...pack, devices, polling }
      setModbus(next)
      if (polling.enabled && typeof openLive === 'function') openLive()
      post('/dsh-vision-bench/workspace', { cwd, modbus: next }).catch(() => { /* keep local */ })
    }

    const pack = normalizeModbus(modbus)
    const polling = pack.polling || {}
    const enabled = polling.enabled === true
    const pythonReady = healthReady(health)
    const deviceList = pack.devices.length ? pack.devices : [pack]
    const sim = deviceList.some((item) => item.sim)
    const canWatch = pythonReady || sim
    const rows = []
    for (const device of deviceList) {
      const valueMap = {}
      for (const item of Array.isArray(device.values) ? device.values : []) {
        if (item && item.key) valueMap[item.key] = item
      }
      for (const point of expandPoints(device.segments)) {
        const rec = valueMap[point.key]
        rows.push({
          key: (device.id || 'd') + ':' + point.key,
          name: (device.name || '') + ' / ' + point.name,
          shown: displayValue(rec, point),
          ok: !rec || rec.ok !== false,
          writable: isWritableFunction(point.function),
          deviceId: device.id,
          fn: point.function,
          address: point.address,
        })
      }
    }
    const openEdit = (row) => {
      setEdit({ rowKey: row.key, name: row.name, deviceId: row.deviceId, fn: row.fn, address: row.address, text: '', busy: false, result: null })
    }
    const submitEdit = () => {
      if (!edit || !cwd) return
      const kind = writeTargetOf(edit.fn).kind
      const values = kind === 'coil'
        ? [Number(edit.text) ? 1 : 0]
        : [Number(edit.text)]
      const check = normalizeWriteValues(edit.fn, values, 1)
      if (!check.ok) {
        setEdit((prev) => ({ ...prev, result: { ok: false, error: check.error } }))
        return
      }
      setEdit((prev) => ({ ...prev, busy: true, result: null }))
      post('/dsh-vision-bench/modbus/write', {
        cwd,
        source: 'user',
        deviceId: edit.deviceId,
        function: edit.fn,
        address: edit.address,
        values,
      }, 60000).then((data) => {
        setEdit((prev) => ({ ...prev, busy: false, result: data }))
      }).catch((err) => {
        setEdit((prev) => ({ ...prev, busy: false, result: { ok: false, error: String((err && err.message) || t('fail')) } }))
      })
    }
    const kind = !cwd || !rows.length || !canWatch
      ? 'idle'
      : (tickError || polling.lastOk === false ? 'err' : (enabled ? 'live' : 'idle'))
    const tabId = props && props.tab && props.tab.id

    return el('div', { className: 'dvb-live', 'data-kind': kind },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveTable')),
        el('span', { className: 'dvb-live-dot', 'data-kind': kind })),
      el('div', { className: 'dvb-live-controls' },
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (enabled ? ' dvb-btn-primary' : ''),
          disabled: !cwd || !canWatch || !rows.length,
          onClick() { persistPolling({ enabled: !enabled }) },
        }, enabled ? t('liveStop') : t('liveStart')),
        el('select', {
          className: 'dvb-input dvb-live-interval',
          value: String(polling.intervalMs || 1000),
          disabled: !cwd,
          onChange(event) { persistPolling({ intervalMs: Number(event.target.value) }) },
        }, INTERVALS.map((ms) => el('option', { key: String(ms), value: String(ms) }, (ms / 1000) + 's'))),
        tabId && typeof closeTab === 'function'
          ? el('button', {
            type: 'button', className: 'dvb-btn dvb-live-close', title: t('liveClose'),
            onClick() { closeTab(tabId) },
          }, '×')
          : null),
      !cwd
        ? el('div', { className: 'dvb-hint' }, t('needWorkspace'))
        : (!canWatch
          ? el('div', { className: 'dvb-need' }, t('needBindingsRead'))
          : (!rows.length
            ? el('div', { className: 'dvb-hint' }, t('liveEmpty'))
            : (sim ? el('div', { className: 'dvb-hint' }, t('simHint')) : null))),
      tickError ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, tickError) : null,
      rows.length
        ? el('div', { className: 'dvb-live-list' }, rows.map((row) => {
          return el('div', {
            key: row.key,
            className: 'dvb-live-row',
            'data-ok': row.ok ? 'true' : 'false',
          },
            el('span', { className: 'dvb-live-name', title: row.name }, row.name),
            el('span', { className: 'dvb-val' }, row.shown),
            row.writable
              ? el('button', {
                type: 'button',
                className: 'dvb-btn dvb-btn-write dvb-live-edit' + (edit && edit.rowKey === row.key ? ' is-on' : ''),
                title: t('writeTitle'),
                disabled: !!edit && edit.busy,
                onClick() { openEdit(row) },
              }, '✎')
              : null)
        }))
        : null,
      edit
        ? el('div', { className: 'dvb-write-panel dvb-write-inline' },
          el('div', { className: 'dvb-write-head' },
            el('span', { className: 'dvb-write-title' }, t('writeTitle') + ' · ' + edit.name),
            el('button', {
              type: 'button', className: 'dvb-btn',
              disabled: edit.busy,
              onClick() { setEdit(null) },
            }, t('writeClose'))),
          el('div', { className: 'dvb-write-form' },
            writeTargetOf(edit.fn).kind === 'coil'
              ? el('select', {
                className: 'dvb-input',
                value: String(Number(edit.text) ? 1 : 0),
                disabled: edit.busy,
                onChange(event) { setEdit((prev) => ({ ...prev, text: event.target.value })) },
              },
                el('option', { value: '0' }, t('coilOff')),
                el('option', { value: '1' }, t('coilOn')))
              : el('input', {
                className: 'dvb-input dvb-input-mono',
                type: 'number',
                min: 0,
                max: 65535,
                value: edit.text,
                disabled: edit.busy,
                spellCheck: false,
                onChange(event) { setEdit((prev) => ({ ...prev, text: event.target.value })) },
                onKeyDown(event) {
                  if (event.key === 'Enter' && !edit.busy) submitEdit()
                },
              }),
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-primary dvb-btn-write',
              disabled: !cwd || edit.busy,
              onClick: submitEdit,
            }, edit.busy ? t('writing') : t('writeConfirm'))),
          edit.result
            ? (edit.result.ok === false
              ? el('div', { className: 'dvb-write-result', 'data-kind': 'err' }, edit.result.error || t('fail'))
              : el('div', { className: 'dvb-write-result', 'data-kind': 'ok' },
                functionTag(edit.fn) + edit.address + ': '
                  + (edit.result.before && edit.result.before[0] !== null && edit.result.before[0] !== undefined ? String(edit.result.before[0]) : '—')
                  + ' → ' + String(edit.result.target && edit.result.target[0])
                  + ' → ' + (edit.result.readback && edit.result.readback[0] !== undefined ? String(edit.result.readback[0]) : '—')))
            : null)
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

export function createAlarmPage(React, t, post) {
  return function AlarmPage(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const [events, setEvents] = React.useState([])
    React.useEffect(() => {
      let stop = false
      function pull() {
        post('/dsh-vision-bench/state', { cwd: cwd || '' }).then((data) => {
          if (stop) return
          const timeline = data && data.journal && Array.isArray(data.journal.timeline)
            ? data.journal.timeline
            : []
          setEvents(timeline.filter((item) => item.kind === 'alarm' || item.kind === 'alarm-clear'))
        }).catch(() => { /* next tick retries */ })
      }
      pull()
      const timer = setInterval(pull, 2000)
      return () => { stop = true; clearInterval(timer) }
    }, [cwd])
    return el('div', { className: 'dvb-live' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('liveAlarm'))),
      events.length
        ? el('div', { className: 'dvb-live-list' }, events.map((item) => el('div', {
          key: item.id,
          className: 'dvb-task',
          'data-ok': item.ok ? 'true' : 'false',
        },
          el('span', { className: 'dvb-map-meta' }, clockOf(item.at)),
          el('span', { className: 'dvb-badge', 'data-source': item.source }, item.source),
          el('span', { className: 'dvb-hint' }, item.summary))))
        : el('div', { className: 'dvb-hint' }, t('alarmEmpty')))
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
