import { getFramesLog, pushFramesLog, clearFramesLog, buildAgentRef, copyAgentRef, dispatchAgentRef, hasHarnessInput } from './bench-shared.mjs'
import { postEvidence, evidenceFromRef } from './bench-shared.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { NS } from './bench-i18n.mjs'
import { buildFramePortOptions, parseFramePortSelection, resolveFrameSelection, selectProtocolFrames, mergeFramesDedup, framesShouldStickToBottom } from './bench-frames-model.mjs'
import { vendorAvailable, vendorUseVirtualizer, vendorVirtualizer } from './bench-vendor.mjs'

// 串口报文侧栏：协议报文使用插件自身 Modbus 事务缓存（持久化 framesByConnection 为权威来源），
// 不重复打开已占用 COM；仅原始数据模式可选打开 COM。
export const FRAMES_TAB_ID = 'dsh-vision-bench:frames'

const ESTIMATE_SIZE = 36
const OVERS_CAN = 10

// Task2/0.18.2: official React virtualizer adapter. `useViz` is stable across
// renders (module scope), so this is a legal unconditional hook call.
const useViz = vendorUseVirtualizer || (() => null)

export function createFramesPage(React, t, post, hooks) {
  const openHmi = hooks && hooks.openHmi
  return function FramesPage(props) {
    const el = React.createElement
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
    const prevVisibleIdsRef = React.useRef([])
    const lastCountRef = React.useRef(0)
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
      if (!realCwd) return
      post('/dsh-vision-bench/serial/close', { cwd: realCwd }).catch(() => {})
      setSerial((p) => ({ ...p, open: false, lines: [], error: '' }))
      setPausedSnapshot(null)
    }, [realCwd, post])
    React.useEffect(() => () => {
      // unmount cleanup: close raw monitor + clear timers
      if (realCwd) post('/dsh-vision-bench/serial/close', { cwd: realCwd }).catch(() => {})
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
      liveFrames = serial.lines.map((l) => ({ t: l.t, at: l.t, request: l.line, response: '', label: l.line.slice(0, 20), direction: 'rx', status: 'ok', connectionId: sel.connectionId || '', deviceId: '', functionCode: 0 }))
    }

    let displayedFrames = paused && pausedSnapshot
      ? (pausedSnapshot[mode] || [])
      : liveFrames
    if (paused && !pausedSnapshot) {
      pauseSnap()
    }
    function pauseSnap() {
      setPausedSnapshot((prev) => ({ ...(prev || {}), [mode]: displayedFrames }))
    }

    // filters + search run on the DISPLAYED layer
    let filtered = displayedFrames
    if (filters.connectionId) filtered = filtered.filter((f) => f.connectionId === filters.connectionId)
    if (filters.deviceId) filtered = filtered.filter((f) => f.deviceId === filters.deviceId)
    if (filters.direction) filtered = filtered.filter((f) => f.direction === filters.direction)
    if (filters.functionCode) filtered = filtered.filter((f) => String(f.functionCode) === String(filters.functionCode))
    if (filters.status) filtered = filtered.filter((f) => f.status === filters.status)
    const needle = search.trim().toLowerCase()
    if (needle) filtered = filtered.filter((f) => (f.request + ' ' + f.response + ' ' + f.label + ' ' + (f.connectionId || '')).toLowerCase().includes(needle))

    // Task3: pending-new accounting + auto-follow after collection
    React.useEffect(() => {
      if (paused) {
        // count growth while paused against the snapshot
        const base = pausedSnapshot ? (pausedSnapshot[mode] || []) : liveFrames
        if (liveFrames.length > base.length) setPendingNew(liveFrames.length - base.length)
        return
      }
      const visibleNow = displayedFrames.map((f) => f.frameId || f.id)
      const prevSet = new Set(prevVisibleIdsRef.current)
      let added = displayedFrames.length - lastCountRef.current
      if (added < 0) added = 0
      // count genuinely-new ids even if count stayed same (wrap)
      if (displayedFrames.length === lastCountRef.current) {
        added = 0
        for (const id of visibleNow) if (!prevSet.has(id)) added++
        if (added > 0 && !wasAtBottomRef.current) setPendingNew((n) => n + added)
        else setPendingNew(0)
      } else if (!wasAtBottomRef.current && added > 0) {
        setPendingNew((n) => n + added)
      } else if (wasAtBottomRef.current && added > 0) {
        setPendingNew(0)
      }
      prevVisibleIdsRef.current = visibleNow.slice(-40)
      lastCountRef.current = displayedFrames.length
      // auto-follow when at bottom
      if (wasAtBottomRef.current && added > 0) {
        requestAnimationFrame(() => scrollToLatest(false))
      }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [liveEpoch, displayedFrames.length])

    function scrollToLatest(updateRef = true) {
      const inst = vizer
      if (inst && inst.scrollToIndex) inst.scrollToIndex(filtered.length - 1)
      else if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      if (updateRef) wasAtBottomRef.current = true
      setPendingNew(0)
    }

    function togglePause() {
      setPaused((v) => {
        const next = !v
        if (next) {
          // freeze current display snapshot for BOTH modes
          setPausedSnapshot({ proto: mode === 'proto' ? (displayedFrames) : liveFrames, raw: mode === 'raw' ? (displayedFrames) : serial.lines })
          setPendingNew((pn) => (liveFrames.length > displayedFrames.length ? liveFrames.length - displayedFrames.length : pn))
        } else {
          // resume: if we were at bottom before pause, follow latest
          setPausedSnapshot(null)
          setPendingNew(0)
          if (wasAtBottomRef.current || lastAtBottomRef.current) setTimeout(() => scrollToLatest(false), 40)
        }
        return next
      })
    }

    // ── Task2: official React virtualizer adapter ──
    const vizer = useViz({
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
    const measureRow = vendorUseVirtualizer && vizer && typeof vizer.measureElement === 'function'
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
        if (serial.open) closeRawMonitor()
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
    }

    function openRawPort() {
      const port = sel && sel.port
      if (!realCwd || !port) return
      post('/dsh-vision-bench/serial/open', { cwd: realCwd, port, baudrate: 115200 }, 15000).then((data) => {
        if (data && data.ok === false && /PORT_IN_USE|占用/.test(data.error || '')) setSerial((pp) => ({ ...pp, error: data.error }))
        else setSerial((pp) => ({ ...pp, open: true, port, error: '' }))
      }).catch((e) => setSerial((pp) => ({ ...pp, error: String(e && e.message || 'fail') })))
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
      const res = dispatchAgentRef(ref, props) || { mode: 'copied' }
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
    const fallbackRows = !vizer && vendorVirtualizer === null
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
      !filtered.length && !vizer && vendorVirtualizer === null ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, '虚拟列表依赖未加载') : null,
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