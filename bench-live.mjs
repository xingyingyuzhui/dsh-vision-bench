import { expandPoints } from './bench-points.mjs'
import { NS } from './bench-i18n.mjs'
import { normalizeModbus } from './bench-devices.mjs'

const TAB_TABLE = 'dsh-vision-bench:modbus'
const TAB_CHART = 'dsh-vision-bench:charts'
const TAB_ALARM = 'dsh-vision-bench:alarms'
const INTERVALS = [500, 1000, 2000, 5000]

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
        rows.push({
          key: (device.id || 'd') + ':' + point.key,
          name: (device.name || '') + ' / ' + point.name,
          rec: valueMap[point.key],
        })
      }
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
          const rec = row.rec
          return el('div', {
            key: row.key,
            className: 'dvb-live-row',
            'data-ok': rec ? (rec.ok ? 'true' : 'false') : '',
          },
            el('span', { className: 'dvb-live-name', title: row.name }, row.name),
            el('span', { className: 'dvb-val' }, rec && rec.ok === false && rec.error ? rec.error : formatPointValue(rec)))
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

export function registerLive(ctx, React, t, LivePage) {
  const bs = ctx.betterSidebar
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
      component: createSoonPage(React, t, 'liveChart', 'chartSoon'),
    }),
    bs.registerTab({
      id: TAB_ALARM,
      title() { return t('liveAlarm') },
      single: true,
      order: 72,
      component: createSoonPage(React, t, 'liveAlarm', 'alarmSoon'),
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
