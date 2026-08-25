import { pushFramesLog, subscribeState, getFramesLog, clearFramesLog, resolveSidebarScope, getSidebarPin, setSidebarPin, buildAgentRef, copyAgentRef, dispatchAgentRef, hasHarnessInput, agentRefToText, getFocusState, setFocusState, isFocusTarget, focusHighlightClass, getTempWatch, setTempWatch, clearTempWatch, shouldStealFocus, shouldHighlightFocus } from './bench-shared.mjs'
import { postEvidence, evidenceFromRef, readInputDraft, buildInputBridge } from './bench-shared.mjs'
import { clockOf, decodeValue, functionTag } from './bench-points.mjs'
import { NS } from './bench-i18n.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { getTrendState, clearTrendState, TREND_CAP, TREND_WINDOW_MS, trendKey, sampleTrend, computeStats, toUplotData, UPLOT_PROTO, exportRangeCsv } from './bench-trend.mjs'
import { normalizeAlarmState, groupAlarms, acknowledgeAlarm, ACTIVE, RECOVERED, ACKED, PROCESS, COMM, COND_ACTIVE, COND_RECOVERED } from './bench-alarm.mjs'
import { vendorUPlot, vendorVirtualizer, vendorAvailable } from './bench-vendor.mjs'

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
    // Task5/0.18.2: hook reads at render top-level, passed into the pure dispatch bridge
    const inputDraft = readInputDraft(props && props.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const [health, setHealth] = React.useState({})
    const [modbus, setModbus] = React.useState({ version: 3, connections: [], devices: [], points: [], values: [], pollingByConnection: {} })
    const [tickError, setTickError] = React.useState('')
    const [search, setSearch] = React.useState('')
    const [pinnedTick, setPinnedTick] = React.useState(0)
    const [paused, setPaused] = React.useState(false)
    const [focusState, setFocusUi] = React.useState({ request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [] })
    const [agentCopied, setAgentCopied] = React.useState('')
    const [tempWatchNote, setTempWatchNote] = React.useState('')
    const [drafts, setDrafts] = React.useState([])
    const [draftBusy, setDraftBusy] = React.useState('')
    const [draftNote, setDraftNote] = React.useState('')

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
            if (data && data.workspace && data.workspace.focus) {
              setFocusUi(data.workspace.focus)
              try { setFocusState(cwd, data.workspace.focus) } catch {}
            }
            const next = data && data.workspace && data.workspace.modbus
            if (next) {
              setModbus(next)
              sampleTrend(cwd, next)
            }
            if (data && data.workspace && Array.isArray(data.workspace.configDrafts)) {
              setDrafts(data.workspace.configDrafts)
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

    function agentRefFor(kind, payload) {
      const p = normalizeModbus(modbus)
      return buildAgentRef(kind, payload, { configVersion: p.configVersion || 1 })
    }

    function sendToAgent(kind, payload) {
      const ref = agentRefFor(kind, payload)
      const res = dispatchAgentRef(ref, agentBridge)
      const key = kind + ':' + (payload && (payload.pointId || payload.id || payload.frameId || payload.connectionId) || '')
      setAgentCopied(key + ':' + res.mode + ':' + res.status)
      setTimeout(() => setAgentCopied(''), 2500)
      // Task4/0.18.2: typed evidence back-mount — failures surface CONFIG_DRIFT/TARGET_MISMATCH
      try {
        postEvidence(post, cwd, evidenceFromRef(ref), (reason) => setTickError(reason))
      } catch {}
      return ref
    }
    function agentBtnLabel(kind, payload) {
      const key = kind + ':' + (payload && (payload.pointId || payload.id || payload.frameId || payload.connectionId) || '')
      if (agentCopied.startsWith(key + ':')) {
        const status = agentCopied.slice(key.length + 1).split(':').slice(1).join(':') || '仅复制'
        return status
      }
      return hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent'
    }

    function requestFocusUi(target, opts) {
      if (!cwd) return
      post('/dsh-vision-bench/focus', {
        cwd,
        target: target || {},
        tempWatchIds: (opts && opts.tempWatchIds) || [],
        evidence: (opts && opts.evidence) || [],
        badgeOnly: !!(opts && opts.badgeOnly),
        foreground: !(opts && opts.badgeOnly),
      }, 15000).catch(() => {})
    }

    function returnToPrevFocus() {
      const prev = focusState && focusState.prev
      if (!prev) return
      requestFocusUi(prev, { badgeOnly: false })
    }

    function createTempWatch(ids) {
      const list = setTempWatch(cwd, ids, 300000)
      setTempWatchNote('临时监视组已创建：' + list.length + ' 点')
      setTimeout(() => setTempWatchNote(''), 2000)
      requestFocusUi(focusState.request || {}, { tempWatchIds: list, badgeOnly: true })
    }

    function resolveDraft(id, action) {
      if (!cwd) return
      setDraftBusy(id + ':' + action)
      setDraftNote('')
      const url = action === 'apply' ? '/dsh-vision-bench/config/draft/apply' : '/dsh-vision-bench/config/draft'
      const body = action === 'apply' ? { cwd, draftId: id } : { cwd, op: 'discard', draftId: id, id }
      post(url, body, 20000).then((data) => {
        if (data && data.ok === false) {
          const code = data.errorCode || ''
          setDraftNote((code === 'CONFIG_DRIFT' ? t('configDrift') + ': ' : '') + (data.error || t('fail')))
        } else {
          setDraftNote(action === 'apply' ? t('draftApplied') : t('draftDiscarded'))
          setTimeout(() => setDraftNote(''), 1800)
        }
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (data && data.workspace && Array.isArray(data.workspace.configDrafts)) setDrafts(data.workspace.configDrafts)
        if (data && data.workspace && data.workspace.modbus) setModbus(data.workspace.modbus)
      }).catch((err) => {
        setDraftNote(String(err && err.message || t('fail')))
      }).finally(() => setDraftBusy(''))
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

    const pendingDrafts = drafts.filter((d) => d && d.status === 'pending')
    const currentCfgVersion = pack.configVersion || 1
    const draftPanel = drafts.length
      ? el('div', { className: 'dvb-panel', style: { margin: '8px 0', padding: '6px 8px', borderLeft: pendingDrafts.length ? '3px solid #e0912f' : '3px solid #4f8ef7' } },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('draftTitle') + (pendingDrafts.length ? ' · ' + pendingDrafts.length + ' 待确认' : '')),
            el('span', { className: 'dvb-tag' }, 'v' + currentCfgVersion)),
          drafts.slice(0, 3).map((d) => {
            const s = d.summary || {}
            const isPending = d.status === 'pending'
            const drift = isPending && currentCfgVersion !== d.baseConfigVersion
            const busyApply = draftBusy === d.id + ':apply'
            const busyDiscard = draftBusy === d.id + ':discard'
            return el('div', { key: d.id, className: 'dvb-task', 'data-status': d.status, style: drift ? { borderLeft: '2px solid #e0912f' } : null },
              el('span', { className: 'dvb-badge', 'data-kind': isPending ? 'warn' : 'ok' }, d.status === 'pending' ? '待确认' : d.status),
              el('span', { className: 'dvb-hint', title: d.id }, d.id.slice(0, 8)),
              el('span', { className: 'dvb-tag' }, 'v' + d.baseConfigVersion + '→v' + currentCfgVersion),
              el('span', { className: 'dvb-tag' }, t('draftAffectedPoints') + ' ' + (s.affectedPoints||0)),
              s.comConflicts && s.comConflicts.length ? el('span', { className: 'dvb-need' }, t('draftComConflict')) : null,
              s.unitIdConflicts && s.unitIdConflicts.length ? el('span', { className: 'dvb-need' }, t('draftUnitConflict')) : null,
              drift && isPending ? el('span', { className: 'dvb-need' }, t('draftDrift')) : null,
              isPending ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm dvb-btn-primary', disabled: busyApply || busyDiscard, onClick() { resolveDraft(d.id, 'apply') } }, busyApply ? t('draftApplying') : t('draftApprove')) : null,
              isPending ? el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', disabled: busyApply || busyDiscard, onClick() { resolveDraft(d.id, 'discard') } }, busyDiscard ? '...' : t('draftDiscard')) : null)
          }),
          draftNote ? el('div', { className: 'dvb-msg', 'data-kind': draftNote.indexOf('漂移')>=0 ? 'err' : 'ok' }, draftNote) : null)
      : null
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
      draftPanel,
      // Agent 聚焦横幅 + 临时监视组 + 证据跳转（后台任务仅角标）
      focusState && focusState.request
        ? el('div', { className: 'dvb-panel dvb-focus-banner', 'data-badge': focusState.badgeOnly ? 'true' : 'false', style: { margin: '8px 0', padding: '6px 8px', borderLeft: focusState.badgeOnly ? '3px solid #e0912f' : '3px solid #4f8ef7', background: focusState.badgeOnly ? 'rgba(224,145,47,.08)' : 'rgba(79,142,247,.08)' } },
            el('div', { style: { display: 'flex', gap: '6px', alignItems: 'center', flexWrap: 'wrap' } },
              el('span', { className: 'dvb-badge', 'data-kind': focusState.badgeOnly ? 'warn' : 'live' }, focusState.badgeOnly ? '后台 · 角标' : 'Agent 聚焦'),
              el('span', { className: 'dvb-hint', title: [focusState.request.connectionId, focusState.request.deviceId, focusState.request.pointId || focusState.request.frameId].filter(Boolean).join(' / ') }, [focusState.request.connectionId, focusState.request.deviceId, focusState.request.pointId || focusState.request.frameId].filter(Boolean).join(' / ') || '未知目标'),
              focusState.request.at ? el('span', { className: 'dvb-map-meta' }, clockOf(focusState.request.at)) : null,
              focusState.badgeOnly ? el('span', { className: 'dvb-hint' }, '后台任务仅角标，不抢焦点') : null,
              el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick: returnToPrevFocus, disabled: !focusState.prev }, '返回原焦点'),
              el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { setFocusUi({ request: null, prev: focusState.request, tempWatchIds: [], badgeOnly: false, evidence: [] }); post('/dsh-vision-bench/focus', { cwd, target: {} }).catch(()=>{}) } }, '清除'),
              focusState.tempWatchIds && focusState.tempWatchIds.length ? el('span', { className: 'dvb-tag' }, '临时监视 ' + focusState.tempWatchIds.length) : null,
              focusState.evidence && focusState.evidence.length ? el('span', { className: 'dvb-tag', title: focusState.evidence.map((e)=> e.kind + ':' + e.id).join('；') }, '证据 ' + focusState.evidence.length) : null),
            el('div', { style: { display: 'flex', gap: '4px', marginTop: '4px' } },
              el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm dvb-btn-primary', onClick() { if (focusState.request && focusState.request.pointId && typeof openHmi === 'function') try { openHmi({ connectionId: focusState.request.connectionId, deviceId: focusState.request.deviceId, pointId: focusState.request.pointId }) } catch {} } }, '跳转点位'),
              el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { if (focusState.request) sendToAgent('focus', focusState.request) } }, agentBtnLabel('focus', focusState.request)),
              tempWatchNote ? el('span', { className: 'dvb-hint' }, tempWatchNote) : null,
              agentCopied ? el('span', { className: 'dvb-hint' }, agentCopied.split(':').pop() + ' · 引用已处理') : null))
        : null,
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
      agentCopied ? el('div', { className: 'dvb-msg', 'data-kind': 'ok' }, agentCopied.split(':').pop() + ' · ' + agentCopied.split(':').slice(0,2).join(':')) : null,
      tempWatchNote ? el('div', { className: 'dvb-hint' }, tempWatchNote) : null,
      rows.length
        ? el('div', { className: 'dvb-live-list' }, rows.map((row) => {
          const isFocused = shouldHighlightFocus(focusState) && focusState.request.pointId === row.key
          const tempWatchIds = getTempWatch(cwd)
          const inTemp = tempWatchIds.includes(row.key)
          return el('div', {
            key: row.key,
            className: 'dvb-live-row' + focusHighlightClass(isFocused) + (inTemp ? ' dvb-temp-watch' : ''),
            'data-ok': row.ok ? 'true' : 'false',
            'data-quality': row.quality,
            'data-connection': row.connectionId,
            'data-device': row.deviceId,
            'data-focused': isFocused ? 'true' : 'false',
            style: isFocused ? { outline: '2px solid #4f8ef7', outlineOffset: '-2px', background: 'rgba(79,142,247,.06)' } : null,
          },
            el('span', { className: 'dvb-live-name', title: row.name + ' [' + row.connectionId + '/' + row.deviceId + ']' }, row.name),
            el('span', { className: 'dvb-val', title: row.rawText ? ('raw ' + row.rawText + ' → ' + row.engText) : row.shown }, row.shown),
            el('span', { className: 'dvb-map-meta', title: t('monitorTime') }, row.at || ''),
            el('span', { className: 'dvb-badge', 'data-quality': row.quality }, row.quality === 'good' ? '' : row.quality),
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              title: '让 Agent 分析此点位（稳定 ID+配置版本+时间范围）',
              onClick() { sendToAgent('point', { pointId: row.key, connectionId: row.connectionId, deviceId: row.deviceId, name: row.name }) },
            }, agentBtnLabel('point', { pointId: row.key })),
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm' + (isFocused ? ' is-on' : ''),
              title: '聚焦此点位 · 高亮并支持临时监视组与返回原焦点',
              onClick() { requestFocusUi({ connectionId: row.connectionId, deviceId: row.deviceId, pointId: row.key, kind: 'point' }) },
            }, '聚焦'),
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm' + (inTemp ? ' is-on' : ''),
              title: '加入/移除临时监视组（后台任务仅角标）',
              onClick() {
                const cur = getTempWatch(cwd)
                const next = cur.includes(row.key) ? cur.filter((id) => id !== row.key) : cur.concat([row.key])
                createTempWatch(next)
              },
            }, inTemp ? '移出临时组' : '加入临时监视'),
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


// Task5: create one uPlot inside a container div. Returns instance or null.
// Only a guarded minimal canvas renderer is kept for the (bundle-less) fallback.
export const drawTrend = (container, cwd = '', now = Date.now()) => {
  if (!container) return null
  const UPlot = vendorUPlot()
  if (!UPlot) return null
  const { data, keys, meta } = toUplotData(cwd, { now, windowMs: TREND_WINDOW_MS })
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

    // Task6/0.18.2: real configVersion — bootstrap via /state then KEEP
    // subscribing to later config changes (drafts applied elsewhere bump it).
    const applyCv = (data) => {
      const mb = data && data.workspace && data.workspace.modbus
      const v = Number(mb && mb.configVersion)
      setConfigVersion(v > 0 ? v : 0)
      setCvReady(true)
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

    const trendState = getTrendState(cwd)
    const entries = []
    let i = 0
    for (const [key, list] of trendState.series) {
      if (!list.length) continue
      const window = list.filter((item) => item.t >= Date.now() - TREND_WINDOW_MS)
      if (!window.length) continue
      let min = Infinity, max = -Infinity, any = false
      for (const item of window) {
        if (item == null || !Number.isFinite(item.v)) continue
        any = true
        if (item.v < min) min = item.v
        if (item.v > max) max = item.v
      }
      const last = list[list.length - 1]
      entries.push({
        key,
        label: (trendState.meta.get(key) && trendState.meta.get(key).label) || key,
        unit: (trendState.meta.get(key) && trendState.meta.get(key).unit) || '',
        last,
        lastValid: any,
        min: any ? min : null,
        max: any ? max : null,
        color: TREND_COLORS[i % TREND_COLORS.length],
      })
      i++
      if (entries.length >= 8) break
    }
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
      if (!uplotRef.current) uplotRef.current = drawTrend(c, cwd)
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
      try { const { data } = toUplotData(cwd); u.setData(data) } catch {}
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
      const w = wrapRef.current, s = w && w._uplotSel, csv = s ? exportRangeCsv(cwd, { start: s.start, end: s.end }) : exportRangeCsv(cwd)
      try { if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) navigator.clipboard.writeText(csv) } catch {}
      setExportNote(s ? '已导出区间 ' + new Date(s.start).toLocaleTimeString() + '→' + new Date(s.end).toLocaleTimeString() : '已导出最近 5 分钟')
      setTimeout(() => setExportNote(''), 2000)
    }
    const resetZoom = () => {
      const w = wrapRef.current; if (w) w._uplotSel = null
      const u = uplotRef.current
      if (u && u.setSelect) try { u.setSelect({ left: 0, width: 0, top: 0, height: 0 }, false) } catch {}
      if (u && u.setData) try { const { data } = toUplotData(cwd); u.setData(data) } catch {}
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
        : el('div', { className: 'dvb-hint' }, t('chartEmpty')),
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
          el('button', {
            type: 'button', className: 'dvb-btn dvb-btn-sm',
            onClick() { focusTrend(item) },
          }, '聚焦'))))
        : null)
  }
}

export function createAlarmPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  const openLive = hooks && hooks.openLive
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
            el('button', {
              type:'button', className:'dvb-btn dvb-btn-sm',
              title: '聚焦此告警，高亮并支持证据跳转',
              onClick(){ focusAlarm(row) },
            }, '聚焦'),
            row.pt ? el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ jumpPoint(row) } }, '点位') : null,
            el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick: jumpChart }, '曲线'),
            el('button', { type:'button', className:'dvb-btn dvb-btn-sm', onClick(){ jumpFrames(row) } }, '报文')
          )}))
        : el('div', { className: 'dvb-hint' }, t('alarmEmpty')),
      events.length ? el('div', { className: 'dvb-hint', style:{marginTop:'8px'} }, '历史事件 '+events.length) : null,
      events.length ? el('div', { className: 'dvb-live-list' }, events.slice(0,6).map((item)=> el('div', { key:item.id, className:'dvb-task', 'data-ok': item.ok?'true':'false' }, el('span', { className:'dvb-map-meta' }, clockOf(item.at)), el('span', { className:'dvb-badge', 'data-source':item.source }, item.source), el('span', { className:'dvb-hint' }, item.summary)))) : null)
  }
}

export function registerLive(ctx, React, t, LivePage, pages = {}) {
  const bs = ctx.betterSidebar
  const TrendPage = pages.trend || createSoonPage(React, t, 'liveChart', 'chartSoon')
  const AlarmPage = pages.alarm || createSoonPage(React, t, 'liveAlarm', 'alarmSoon')
  const FramesPage = pages.frames || createSoonPage(React, t, 'framesTab', 'framesEmpty')
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
    bs.registerTab({
      id: TAB_FRAMES,
      title() { return t('framesTab') },
      single: true,
      order: 73,
      component: FramesPage,
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

export const _internal = { TAB_TABLE, TAB_CHART, TAB_ALARM, TAB_FRAMES, getBetterSidebar }
