import { getFramesLog, pushFramesLog, clearFramesLog, buildAgentRef, copyAgentRef, dispatchAgentRef, hasHarnessInput } from './bench-shared.mjs'
import { postEvidence, evidenceFromRef, readInputDraft, buildInputBridge } from './bench-shared.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { NS } from './bench-i18n.mjs'
import { buildFramePortOptions, parseFramePortSelection, resolveFrameSelection, selectProtocolFrames, mergeFramesDedup, framesShouldStickToBottom, countAddedFrameIds, frameStreamKey, rawLineId } from './bench-frames-model.mjs'
import { vendorAvailable, vendorUseVirtualizer, vendorVirtualizer } from './bench-vendor.mjs'

// 串口报文侧栏：协议报文使用插件自身 Modbus 事务缓存（持久化 framesByConnection 为权威来源），
// 不重复打开已占用 COM；仅原始数据模式可选打开 COM。
export const FRAMES_TAB_ID = 'dsh-vision-bench:frames'

const ESTIMATE_SIZE = 36
const OVERS_CAN = 10

// Task2/0.18.2: official React virtualizer adapter. `useViz` is stable across
// renders (module scope), so this is a legal unconditional hook call.
// lazy: vendor only exists after the ModuleLoader factory runs (or late global install in tests)
const useViz = vendorUseVirtualizer() || (() => null)

export function createFramesPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  // Task8/0.18.3: the virtualizer hook is injected ONCE per page factory —
  // tests pass the official adapter explicitly, production uses DvbVendor's.
  const useVizForPage = (hooks && typeof hooks.useVirtualizer === 'function' && hooks.useVirtualizer) || useViz
  return function FramesPage(props) {
    const el = React.createElement
    // Task5/0.18.2: hook reads at render top-level, passed into the pure dispatch bridge
    const inputDraft = readInputDraft(props && props.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const realCwd = (() => {
      try {
        if (props && props.scope && props.scope.cwd) return props.scope.cwd
        if (props && props.useSessions) {
          const sid = (props.scope && props.scope.sessionId) || props.sessionId
          return props.useSessions((s) => (s.byId && sid && s.byId[sid] && s.byId[sid].cwd) || (s.byId && s.current && s.byId[s.current] && s.byId[s.current].cwd) || '')
        }
      } catch {}
      return ''
    })()
    const [health, setHealth] = React.useState({})
    const [modbus, setModbus] = React.useState({ version: 3, connections: [], devices: [], points: [], framesByConnection: {} })
    const [ports, setPorts] = React.useState([])
    const [selection, setSelection] = React.useState('all') // all | conn:<id> | raw:<port>
    const [mode, setMode] = React.useState('proto') // proto: 协议报文, raw: 原始数据
    const [filters, setFilters] = React.useState({ connectionId: '', deviceId: '', direction: '', functionCode: '', status: '' })
    const [search, setSearch] = React.useState('')
    const [paused, setPaused] = React.useState(false)
    const [serial, setSerial] = React.useState({ open: false, port: '', baudrate: 115200, lines: [], error: '', lastId: 0 })
    const [copied, setCopied] = React.useState('')
    const [liveEpoch, setLiveEpoch] = React.useState(0) // bump when new frames collected
    const [pendingNew, setPendingNew] = React.useState(0) // 新增数量（非总量）
    const [pausedSnapshot, setPausedSnapshot] = React.useState(null) // {proto: [], raw: []}
    const listRef = React.useRef(null)
    const wasAtBottomRef = React.useRef(true)
    const cursorRef = React.useRef(new Map())
    const openedByFramesRef = React.useRef(false)
    const lastAtBottomRef = React.useRef(true)

    // state polling → persisted framesByConnection + memory merge (Task3 live collection)
    React.useEffect(() => {
      if (!realCwd) return undefined
      let stop = false
      const timer = setInterval(async () => {
        try {
          const data = await post('/dsh-vision-bench/state', { cwd: realCwd })
          if (stop) return
          if (data && data.health) setHealth(data.health)
          const mb = data && data.workspace && data.workspace.modbus
          if (mb) setModbus((prev) => ({ ...prev, ...mb }))
          setLiveEpoch((n) => n + 1)
        } catch {}
      }, 1200)
      return () => { stop = true; clearInterval(timer) }
    }, [realCwd])

    // raw-data mode feed — keeps collecting in background even while paused
    React.useEffect(() => {
      if (mode !== 'raw' || !realCwd || !serial.open) return undefined
      let stop = false
      const timer = setInterval(() => {
        post('/dsh-vision-bench/serial/feed', { cwd: realCwd, since: serial.lastId }, 10000).then((data) => {
          if (stop || !data) return
          if (data.error && /PORT_IN_USE|占用/.test(data.error)) {
            setSerial((prev) => ({ ...prev, error: data.error, open: false }))
            return
          }
          setSerial((prev) => {
            const next = {
              ...prev,
              open: data.open !== false,
              error: data.error || '',
              lastId: data.lastId || prev.lastId,
              // background buffer always grows; display freeze is handled by snapshot
              lines: prev.lines.concat(Array.isArray(data.lines) ? data.lines : []).slice(-2000),
            }
            return next
          })
          setLiveEpoch((n) => n + 1)
        }).catch(() => {})
      }, 700)
      return () => { stop = true; clearInterval(timer) }
    }, [realCwd, mode, serial.open, serial.lastId])

    // Task3: close raw monitor when switching away from raw or unmounting
    const closeRawMonitor = React.useCallback(() => {
      // Task7/0.18.3: only close a serial monitor this page successfully opened
      if (openedByFramesRef.current) {
        if (realCwd) post('/dsh-vision-bench/serial/close', { cwd: realCwd }).catch(() => {})
        openedByFramesRef.current = false
      }
      setSerial((pp) => ({ ...pp, open: false, lines: [], error: '' }))
      setPausedSnapshot(null)
    }, [realCwd, post])
    React.useEffect(() => () => {
      // Task7/0.18.3: unmount cleanup closes ONLY what this page opened
      if (openedByFramesRef.current && realCwd) {
        post('/dsh-vision-bench/serial/close', { cwd: realCwd }).catch(() => {})
        openedByFramesRef.current = false
      }
    }, [realCwd, post])

    const pack = (() => { try { return normalizeModbus(modbus) } catch { return { connections: [], devices: [], points: [], framesByConnection: {} } } })()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []
    const framesByConnection = (pack && pack.framesByConnection) || {}
    const sel = resolveFrameSelection(selection, connections, { mode })
    const portOptions = buildFramePortOptions(connections, ports, mode)

    // Task3: two data layers — live keeps collecting; displayed freezes when paused
    let liveFrames = []
    if (mode === 'proto') {
      if (sel.kind === 'conn') {
        const persistedArray = framesByConnection[sel.connectionId]
        const mem = getFramesLog(realCwd, sel.connectionId)
        liveFrames = mergeFramesDedup(persistedArray, mem, 500)
      } else {
        liveFrames = mergeFramesDedup(selectProtocolFrames(framesByConnection, 'all'), getFramesLog(realCwd), 1000)
      }
    } else {
      // Task5/0.18.3: raw lines keep stable ids (never array index)
      liveFrames = serial.lines.map((l, idx) => ({
        t: l.t, at: l.t, request: l.line, response: '',
        id: rawLineId(sel.port || 'raw', l, idx),
        frameId: rawLineId(sel.port || 'raw', l, idx),
        label: l.line.slice(0, 20), direction: 'rx', status: 'ok',
        connectionId: sel.connectionId || '', deviceId: '', functionCode: 0,
      }))
    }

    // Task6/0.18.3: display snapshot ONLY from state — no setState during render
    let displayedFrames = paused && pausedSnapshot
      ? (pausedSnapshot[mode] || [])
      : liveFrames

    // filters + search run on the DISPLAYED layer
    let filtered = displayedFrames
    if (filters.connectionId) filtered = filtered.filter((f) => f.connectionId === filters.connectionId)
    if (filters.deviceId) filtered = filtered.filter((f) => f.deviceId === filters.deviceId)
    if (filters.direction) filtered = filtered.filter((f) => f.direction === filters.direction)
    if (filters.functionCode) filtered = filtered.filter((f) => String(f.functionCode) === String(filters.functionCode))
    if (filters.status) filtered = filtered.filter((f) => f.status === filters.status)
    const needle = search.trim().toLowerCase()
    if (needle) filtered = filtered.filter((f) => (f.request + ' ' + f.response + ' ' + f.label + ' ' + (f.connectionId || '')).toLowerCase().includes(needle))

    // Task5+6/0.18.3: per-stream idle/added accounting with FULL previous-id sets.
    // Cursors are keyed by mode|selection so COM/connection/mode never pollute
    // each other; the first observation of a stream is a pure baseline.
    const streamKey = frameStreamKey(mode, selection)
    const liveIds = liveFrames.map((f) => String(f.frameId || f.id || ''))
    React.useEffect(() => {
      const cursors = cursorRef.current
      let cur = cursors.get(streamKey)
      if (!cur) {
        // first entry of this stream → baseline only, never "new"
        cursors.set(streamKey, { anchor: new Set(liveIds), pausedAnchor: null })
        setPendingNew(0)
        return
      }
      if (paused) {
        // freeze anchor at pause; kept growing while live keeps collecting
        if (!cur.pausedAnchor) cur.pausedAnchor = cur.anchor
        const addedPaused = countAddedFrameIds(cur.pausedAnchor, liveIds)
        setPendingNew(addedPaused)
        return
      }
      const added = countAddedFrameIds(cur.anchor, liveIds)
      cur.anchor = new Set(liveIds)
      cur.pausedAnchor = null
      if (added > 0 && !wasAtBottomRef.current) {
        setPendingNew((n) => n + added)
      } else {
        setPendingNew(0)
      }
      // auto-follow only when the user is already at the bottom
      if (added > 0 && wasAtBottomRef.current) {
        requestAnimationFrame(() => scrollToLatest(false))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveEpoch, streamKey, paused])

    function resetCursors() {
      cursorRef.current.clear()
      setPendingNew(0)
    }

    function scrollToLatest(updateRef = true) {
      const inst = vizer
      if (inst && inst.scrollToIndex) inst.scrollToIndex(filtered.length - 1)
      else if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      if (updateRef) wasAtBottomRef.current = true
      setPendingNew(0)
    }

    function togglePause() {
      const next = !paused
      if (next) {
        // Task6/0.18.3: atomic snapshot on the pause CLICK (never in render)
        const snap = displayedFrames.map((f) => ({ ...f }))
        setPausedSnapshot({ [mode]: snap })
        // freeze the stream anchor at the snapshot so paused growth is counted
        const cursors = cursorRef.current
        const cur = cursors.get(streamKey)
        if (cur) cur.pausedAnchor = new Set(liveIds)
      } else {
        // resume shows the live state; follow latest only if paused-at-bottom
        setPausedSnapshot(null)
        const wasBottom = wasAtBottomRef.current || lastAtBottomRef.current
        const cursors = cursorRef.current
        const cur = cursors.get(streamKey)
        if (cur) { cur.pausedAnchor = null; cur.anchor = new Set(liveIds) }
        setPendingNew(0)
        if (wasBottom) setTimeout(() => scrollToLatest(false), 40)
      }
      setPaused(next)
    }

    // ── Task2: official React virtualizer adapter ──
    const vizer = useVizForPage({
      count: filtered.length,
      getScrollElement: () => listRef.current,
      estimateSize: () => ESTIMATE_SIZE,
      overscan: OVERS_CAN,
      getItemKey: (index) => {
        const f = filtered[index]
        return f ? (f.frameId || f.id || String(index)) : String(index)
      },
      onChange: (instance) => {
        const el = listRef.current
        if (el) {
          const atBottom = framesShouldStickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
          wasAtBottomRef.current = atBottom
          lastAtBottomRef.current = atBottom
        }
      },
    })
    const measureRow = vendorUseVirtualizer() && vizer && typeof vizer.measureElement === 'function'
      ? (node) => { if (node) vizer.measureElement(node) }
      : undefined
    const trackingRef = measureRow
      ? (node) => { if (node) vizer.measureElement(node) }
      : undefined

    const virtualRows = vizer && vizer.getVirtualItems ? vizer.getVirtualItems() : []
    const totalHeight = vizer && vizer.getTotalSize ? vizer.getTotalSize() : filtered.length * ESTIMATE_SIZE

    // Task3: mode switching — proto: drop raw selections, close raw monitor;
    // raw: keep valid conn ids, never auto-open.
    function switchMode(nextMode) {
      if (nextMode === mode) return
      if (nextMode === 'proto') {
        const p = parseFramePortSelection(selection)
        if (p.kind === 'raw') setSelection('all')
        if (openedByFramesRef.current && serial.open) closeRawMonitor()
        setSerial((s) => ({ ...s, error: '' }))
        setPausedSnapshot(null)
        setPendingNew(0)
      } else {
        // raw: keep conn:<id> (resolvable to its port later); nothing auto-opens
        setSerial((s) => ({ ...s, error: '' }))
        setPausedSnapshot(null)
        setPendingNew(0)
      }
      setMode(nextMode)
      setPaused(false)
      resetCursors()
    }

    function openRawPort() {
      const port = sel && sel.port
      if (!realCwd || !port) return
      post('/dsh-vision-bench/serial/open', { cwd: realCwd, port, baudrate: 115200 }, 15000).then((data) => {
        // Task7/0.18.3: ONLY data.ok===true opens; every failure surfaces as error
        if (data && data.ok === true) {
          openedByFramesRef.current = true
          setSerial((pp) => ({ ...pp, open: true, port, error: '' }))
        } else {
          openedByFramesRef.current = false
          setSerial((pp) => ({ ...pp, open: false, error: (data && data.error) || '打开串口失败' }))
        }
      }).catch((e) => {
        openedByFramesRef.current = false
        setSerial((pp) => ({ ...pp, open: false, error: String(e && e.message || '打开串口失败') }))
      })
    }

    function clearView() {
      const payload = sel.kind === 'conn' ? { connectionId: sel.connectionId } : { all: true }
      // optimistic local clear, then server; on failure restore from server state
      const prevFbc = modbus.framesByConnection
      setModbus((prev) => {
        const fbc = { ...(prev.framesByConnection || {}) }
        if (payload.connectionId) delete fbc[payload.connectionId]
        else for (const k of Object.keys(fbc)) delete fbc[k]
        return { ...prev, framesByConnection: fbc }
      })
      if (sel.kind === 'conn') clearFramesLog(realCwd, sel.connectionId)
      else clearFramesLog(realCwd)
      resetCursors()
      setPausedSnapshot(null)
      post('/dsh-vision-bench/frames/clear', { cwd: realCwd, ...payload }).then((data) => {
        if (!data || data.ok === false) {
          setError(data && data.error ? data.error : '清空失败')
          // restore optimistic state from known-good copy
          setModbus((prev) => ({ ...prev, framesByConnection: prevFbc }))
          return
        }
        // verify: refresh /state once
        return post('/dsh-vision-bench/state', { cwd: realCwd }).then((st) => {
          if (st && st.workspace && st.workspace.modbus) setModbus((prev) => ({ ...prev, ...st.workspace.modbus }))
        })
      }).catch((e) => {
        setError(String(e && e.message || '清空失败'))
        setModbus((prev) => ({ ...prev, framesByConnection: prevFbc }))
      })
    }
    const [error, setError] = React.useState('')

    function sendToAgent(frame) {
      const configVersion = Number(pack.configVersion) > 0 ? Number(pack.configVersion) : null
      if (!configVersion) { setCopied('no-version'); setTimeout(() => setCopied(''), 2000); return }
      // Task4: typed evidence reference — kind frame with frameId, not id-as-point
      const ref = buildAgentRef('frame', {
        frameId: frame.frameId || frame.id,
        connectionId: frame.connectionId,
        deviceId: frame.deviceId,
        label: frame.label,
      }, { configVersion, start: (frame.t || frame.at || Date.now()) - 5 * 60 * 1000, end: frame.t || frame.at || Date.now() })
      const res = dispatchAgentRef(ref, agentBridge) || { mode: 'copied' }
      const labelByMode = { input: '已加入输入框', sent: '已发送', copied: '仅复制', failed: '处理失败' }
      setCopied(labelByMode[res.mode] || '仅复制')
      setTimeout(() => setCopied(''), 2000)
      // Task4/0.18.2: evidence append must surface CONFIG_DRIFT/TARGET_MISMATCH, never silent
      postEvidence(post, realCwd, evidenceFromRef(ref), (reason) => {
        setError(reason)
        // reference already entered the input — keep the ref text visible
        try { copyAgentRef(ref) } catch {}
      })
    }

    function copyFrames() {
      const text = filtered.map((f) => `[${new Date(f.t || f.at).toLocaleTimeString()}] ${f.direction || 'tx'} ${f.request || ''} ${f.response ? '← ' + f.response : ''} ${f.connectionId || ''}`).join('\n')
      if (!text) return
      try { navigator.clipboard.writeText(text).then(() => { setCopied('copy'); setTimeout(() => setCopied(''), 1500) }) } catch {}
    }
    function exportFrames() {
      const blob = filtered.map((f) => JSON.stringify(f)).join('\n')
      if (!blob) return
      try { navigator.clipboard.writeText(blob).then(() => { setCopied('export'); setTimeout(() => setCopied(''), 1500) }) } catch {}
    }

    const banner = !paused && pendingNew > 0
      ? '有 ' + pendingNew + ' 条新报文 · 点击回到底部'
      : (paused ? '已暂停' + (pendingNew > 0 ? '，新增 ' + pendingNew + ' 条' : '') : '')

    // fallback rows (vendor missing) shape: {index,start,size,key} per plan
    const fallbackRows = !vizer && vendorVirtualizer() === null
      ? filtered.slice(0, 30).map((f, index) => ({ index, start: index * ESTIMATE_SIZE, size: ESTIMATE_SIZE, key: f.frameId || f.id || String(index), f }))
      : []
    const rows = vizer ? virtualRows : fallbackRows

    return el('div', { className: 'dvb-live dvb-frames-page', 'data-mode': mode },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('framesTab') || '串口报文'),
        el('span', { className: 'dvb-chip', 'data-kind': mode === 'proto' ? 'ready' : 'warn' }, mode === 'proto' ? (t('framesProto') || '协议报文') : (t('framesRaw') || '原始数据')),
        el('button', { type: 'button', className: 'dvb-btn' + (mode === 'proto' ? ' is-on' : ''), onClick() { switchMode('proto') } }, t('framesProto') || '协议报文'),
        el('button', { type: 'button', className: 'dvb-btn' + (mode === 'raw' ? ' is-on' : ''), onClick() { switchMode('raw') } }, t('framesRaw') || '原始数据'),
        el('button', { type: 'button', className: 'dvb-btn', onClick: togglePause }, paused ? (t('serialResume') || '恢复') : (t('serialPause') || '暂停')),
        el('button', { type: 'button', className: 'dvb-btn', disabled: !filtered.length, onClick: copyFrames }, copied === 'copy' ? (t('serialCopied') || '已复制') : (t('framesCopyHex') || '复制')),
        el('button', { type: 'button', className: 'dvb-btn', disabled: !filtered.length, onClick: exportFrames }, t('framesExport') || '导出'),
        mode === 'raw' ? el('button', { type: 'button', className: 'dvb-btn', disabled: serial.open || !sel.port, onClick: openRawPort }, serial.open ? (t('serialClose') || '已打开') : (t('serialOpen') || '打开串口')) : null,
        mode === 'raw' && serial.open ? el('button', { type: 'button', className: 'dvb-btn', onClick: closeRawMonitor }, t('serialClose') || '关闭串口') : null,
        mode === 'proto' ? el('button', { type: 'button', className: 'dvb-btn', onClick: clearView }, t('framesClear') || '清空') : null
      ),
      el('div', { className: 'dvb-toolbar' },
        el('select', { className: 'dvb-input', value: selection, onChange: (e) => { setSelection(e.target.value); setPendingNew(0) } },
          portOptions.map((o) => el('option', { key: o.value, value: o.value }, o.label))
        ),
        el('select', { className: 'dvb-input', value: filters.connectionId, onChange: (e) => setFilters((p) => ({ ...p, connectionId: e.target.value })) },
          el('option', { value: '' }, '全部连接'), connections.map((c) => el('option', { key: c.id, value: c.id }, c.name))
        ),
        el('select', { className: 'dvb-input', value: filters.deviceId, onChange: (e) => setFilters((p) => ({ ...p, deviceId: e.target.value })) },
          el('option', { value: '' }, '全部设备'), devices.map((d) => el('option', { key: d.id, value: d.id }, d.name + ' · Unit ' + d.unitId))
        ),
        el('select', { className: 'dvb-input', value: filters.direction, onChange: (e) => setFilters((p) => ({ ...p, direction: e.target.value })) },
          el('option', { value: '' }, '全部方向'), el('option', { value: 'tx' }, 'TX'), el('option', { value: 'rx' }, 'RX')
        ),
        el('select', { className: 'dvb-input', value: filters.functionCode, onChange: (e) => setFilters((p) => ({ ...p, functionCode: e.target.value })) },
          el('option', { value: '' }, '全部功能码'), [1, 2, 3, 4, 5, 6, 15, 16].map((fc) => el('option', { key: String(fc), value: String(fc) }, 'FC' + fc))
        ),
        el('select', { className: 'dvb-input', value: filters.status, onChange: (e) => setFilters((p) => ({ ...p, status: e.target.value })) },
          el('option', { value: '' }, '全部状态'), el('option', { value: 'ok' }, '成功'), el('option', { value: 'err' }, '失败'), el('option', { value: 'timeout' }, '超时')
        )
      ),
      el('div', { className: 'dvb-live-search' },
        el('input', { className: 'dvb-input', value: search, placeholder: t('serialFilter') || '过滤关键字', onChange: (e) => setSearch(e.target.value) })
      ),
      serial.error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, serial.error) : null,
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      !filtered.length && !vizer && vendorVirtualizer() === null ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, '虚拟列表依赖未加载') : null,
      !filtered.length ? el('div', { className: 'dvb-hint' }, t('framesEmpty') || '暂无报文') : null,
      banner ? el('div', { className: 'dvb-hint dvb-new-banner', onClick: () => scrollToLatest(), role: 'button' }, banner) : null,
      el('div', { className: 'dvb-live-list dvb-frames-virtual', style: { height: '320px', overflowY: 'auto', position: 'relative' }, ref: listRef, onScroll: () => {
        const el2 = listRef.current
        if (el2) wasAtBottomRef.current = framesShouldStickToBottom(el2.scrollTop, el2.scrollHeight, el2.clientHeight)
      } },
        el('div', { style: { height: totalHeight + 'px', position: 'relative', width: '100%' } },
          rows.map((item) => {
            const f = filtered[item.index]
            if (!f) return null
            const fid = f.frameId || f.id
            return el('div', {
              key: fid !== undefined ? String(fid) : String(item.key !== undefined ? item.key : item.index),
              className: 'dvb-live-row',
              ref: trackingRef,
              'data-index': item.index,
              'data-frameid': fid !== undefined ? String(fid) : '',
              style: { position: 'absolute', top: 0, left: 0, width: '100%', transform: 'translateY(' + item.start + 'px)', height: (item.size || ESTIMATE_SIZE) + 'px' },
            },
              el('span', { className: 'dvb-map-meta' }, new Date(f.t || f.at || Date.now()).toLocaleTimeString()),
              el('span', { className: 'dvb-badge' }, f.direction || 'tx'),
              el('span', { className: 'dvb-hint', title: f.connectionId || '' }, f.connectionId || ''),
              el('span', { className: 'dvb-hint' }, f.label || f.request || ''),
              el('span', { className: 'dvb-badge', 'data-kind': f.status === 'ok' ? 'ready' : 'err' }, f.status || 'ok'),
              el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { if (typeof openHmi === 'function') try { openHmi({ connectionId: f.connectionId, deviceId: f.deviceId, frameId: fid }) } catch {} } }, t('openInHmi') || '在上位机打开'),
              el('button', { type: 'button', className: 'dvb-btn dvb-btn-sm', onClick() { sendToAgent(f) } }, copied === '已加入输入框' ? '已加入' : (copied === '已发送' ? '已发送' : (hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent')))
            )
          })
        )
      ),
      el('div', { className: 'dvb-hint' }, '本插件 TX/RX · 协议报文来自内部缓存，非总线嗅探')
    )
  }
}