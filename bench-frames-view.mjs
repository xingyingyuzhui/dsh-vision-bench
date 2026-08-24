import { getFramesLog, pushFramesLog, clearFramesLog, buildAgentRef, copyAgentRef, dispatchAgentRef, hasHarnessInput } from './bench-shared.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { NS } from './bench-i18n.mjs'
import { buildFramePortOptions, parseFramePortSelection, selectProtocolFrames, mergeFramesDedup, framesShouldStickToBottom } from './bench-frames-model.mjs'
import { vendorVirtualizer } from './bench-vendor.mjs'

// 串口报文侧栏：协议报文使用插件自身 Modbus 事务缓存（持久化 framesByConnection 为权威来源），
// 不重复打开已占用 COM；仅原始数据模式可选打开 COM。
export const FRAMES_TAB_ID = 'dsh-vision-bench:frames'

const ESTIMATE_SIZE = 36
const OVERS_CAN = 10

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
    const [feed, setFeed] = React.useState(0) // realtime tick to refresh latest frames
    const [staleNote, setStaleNote] = React.useState('')
    const listRef = React.useRef(null)
    const isAtBottomRef = React.useRef(true)
    const vizerRef = React.useRef(null)
    const [, forceRender] = React.useState(0)

    function countScroll() {
      const el = listRef.current
      if (el) {
        const atBottom = framesShouldStickToBottom(el.scrollTop, el.scrollHeight, el.clientHeight)
        if (isAtBottomRef.current !== atBottom) isAtBottomRef.current = atBottom
      }
    }

    React.useEffect(() => {
      let stop = false
      async function fetchPorts() {
        try {
          const data = await post('/dsh-vision-bench/serial/ports', {}, 30000)
          if (!stop) setPorts(Array.isArray(data && data.ports) ? data.ports : [])
        } catch { if (!stop) setPorts([]) }
      }
      fetchPorts()
      return () => { stop = true }
    }, [realCwd])

    // authoritative persisted framesByConnection from /state + realtime memory
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
          setFeed((n) => n + 1)
        } catch {}
      }, 1500)
      return () => { stop = true; clearInterval(timer) }
    }, [realCwd])

    // raw data mode feed
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
          setSerial((prev) => ({
            ...prev,
            open: data.open !== false,
            error: data.error || '',
            lastId: data.lastId || prev.lastId,
            lines: Array.isArray(data.lines) && data.lines.length
              ? (paused ? prev.lines : prev.lines.concat(data.lines).slice(-2000))
              : prev.lines,
          }))
        }).catch(() => {})
      }, 700)
      return () => { stop = true; clearInterval(timer) }
    }, [realCwd, mode, serial.open, serial.lastId, paused])

    const pack = (() => { try { return normalizeModbus(modbus) } catch { return { connections: [], devices: [], points: [], framesByConnection: {} } } })()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []
    const framesByConnection = (pack && pack.framesByConnection) || {}
    const sel = parseFramePortSelection(selection)

    // Task2 identity: options use all/conn:<id>/raw:<port>; count excludes
    // unconfigured ports in proto mode.
    const portOptions = buildFramePortOptions(connections, ports, mode)

    // proto data source: persisted authoritative frames + live memory merging by frameId
    let rawFrames = []
    if (mode === 'proto') {
      const persistedArray = framesByConnection && sel.connectionId ? framesByConnection[sel.connectionId] : null
      // merge by conn or all
      if (sel.kind === 'conn') {
        const mem = getFramesLog(realCwd, sel.connectionId)
        rawFrames = mergeFramesDedup(persistedArray, mem, 500)
      } else {
        const persistedAll = selectProtocolFrames(framesByConnection, 'all')
        const memAll = getFramesLog(realCwd)
        rawFrames = mergeFramesDedup(persistedAll, memAll, 1000)
      }
    } else {
      rawFrames = serial.lines.map((l) => ({ t: l.t, at: l.t, request: l.line, response: '', label: l.line.slice(0, 20), direction: 'rx', status: 'ok', connectionId: sel.connectionId || '', deviceId: '', functionCode: 0 }))
    }

    let filtered = rawFrames
    if (filters.connectionId) filtered = filtered.filter((f) => f.connectionId === filters.connectionId)
    if (filters.deviceId) filtered = filtered.filter((f) => f.deviceId === filters.deviceId)
    if (filters.direction) filtered = filtered.filter((f) => f.direction === filters.direction)
    if (filters.functionCode) filtered = filtered.filter((f) => String(f.functionCode) === String(filters.functionCode))
    if (filters.status) filtered = filtered.filter((f) => f.status === filters.status)
    const needle = search.trim().toLowerCase()
    if (needle) {
      filtered = filtered.filter((f) => (f.request + ' ' + f.response + ' ' + f.label + ' ' + (f.connectionId || '')).toLowerCase().includes(needle))
    }

    // Task4: real TanStack Virtualizer (bundled) with onChange -> re-render
    React.useEffect(() => { countScroll() })

    React.useEffect(() => {
      if (!vendorVirtualizer) {
        vizerRef.current = null
        return
      }
      const inst = new vendorVirtualizer({
        count: filtered.length,
        getScrollElement: () => listRef.current,
        estimateSize: () => ESTIMATE_SIZE,
        overscan: OVERS_CAN,
        scrollToFn: (offset, _canSmooth, instance) => {
          const el = instance.scrollElement
          if (el) el.scrollTop = offset
        },
        observeElementRect: (instance, cb) => {
          const el = instance.scrollElement
          if (!el) return () => {}
          const ro = new ResizeObserver(() => {
            cb({ width: el.clientWidth || el.offsetWidth || 0, height: el.clientHeight || el.offsetHeight || 0 })
          })
          ro.observe(el)
          cb({ width: el.clientWidth || el.offsetWidth || 0, height: el.clientHeight || el.offsetHeight || 0 })
          return () => ro.disconnect()
        },
        observeElementOffset: (instance, cb) => {
          const el = instance.scrollElement
          if (!el) return () => {}
          const onScroll = () => { cb(el.scrollTop, false) }
          el.addEventListener('scroll', onScroll, { passive: true })
          cb(el.scrollTop, false)
          return () => el.removeEventListener('scroll', onScroll)
        },
        onChange: () => {
          countScroll()
          forceRender((n) => n + 1)
        },
      })
      vizerRef.current = inst
      inst.measure()
      return () => { try { inst.destroy() } catch {} vizerRef.current = null }
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [realCwd, mode, selection, filters.connectionId, filters.deviceId, filters.direction, filters.functionCode, filters.status, search, filtered.length])

    // on mount / filter-change, ensure scroll position sane
    React.useEffect(() => { countScroll() })

    const virtualRows = vendorVirtualizer && vizerRef.current
      ? vizerRef.current.getVirtualItems()
      : filtered.slice(0, 30)
    const totalHeight = vendorVirtualizer && vizerRef.current
      ? vizerRef.current.getTotalSize()
      : filtered.length * ESTIMATE_SIZE

    function scrollToLatest() {
      const inst = vizerRef.current
      if (inst) inst.scrollToIndex(filtered.length - 1)
      else if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight
      isAtBottomRef.current = true
      setStaleNote('')
    }

    function togglePause() {
      setPaused((v) => {
        const next = !v
        // restore to latest when unpausing from bottom
        if (!next && isAtBottomRef.current) setTimeout(scrollToLatest, 30)
        return next
      })
    }

    function clearView() {
      // task3: clear persisted server frames + local cache via dedicated route
      const payload = sel.kind === 'conn' ? { connectionId: sel.connectionId } : { all: true }
      setModbus((prev) => {
        const fbc = { ...(prev.framesByConnection || {}) }
        if (payload.connectionId) delete fbc[payload.connectionId]
        else for (const k of Object.keys(fbc)) delete fbc[k]
        return { ...prev, framesByConnection: fbc }
      })
      // optimistic local clear then server
      if (sel.kind === 'conn') clearFramesLog(realCwd, sel.connectionId)
      else clearFramesLog(realCwd)
      post('/dsh-vision-bench/frames/clear', { cwd: realCwd, ...payload }).then(() => {
        setFeed((n) => n + 1)
      }).catch(() => {})
    }

    // Agent references / dispatch (Task7)
    function sendToAgent(frame) {
      const configVersion = Number(pack.configVersion) > 0 ? Number(pack.configVersion) : null
      if (!configVersion) {
        setCopied('no-version')
        setTimeout(() => setCopied(''), 2000)
        return
      }
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
      try {
        post('/dsh-vision-bench/evidence', {
          cwd: realCwd,
          evidence: [{ kind: 'frame', id: frame.frameId || frame.id, connectionId: frame.connectionId, deviceId: frame.deviceId, at: frame.t || frame.at || Date.now(), version: configVersion, timeRange: null }],
        }).catch(() => {})
      } catch {}
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

    const newRowsHint = isAtBottomRef.current
      ? ''
      : (paused ? '已暂停' : (filtered.length ? '有 ' + filtered.length + ' 条报文' : ''))

    return el('div', { className: 'dvb-live dvb-frames-page', 'data-mode': mode },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('framesTab') || '串口报文'),
        el('span', { className: 'dvb-chip', 'data-kind': mode === 'proto' ? 'ready' : 'warn' }, mode === 'proto' ? t('framesProto') : t('framesRaw')),
        el('button', { type: 'button', className: 'dvb-btn' + (mode === 'proto' ? ' is-on' : ''), onClick() { setMode('proto'); setSerial((p) => ({ ...p, error: '' })) } }, t('framesProto') || '协议报文'),
        el('button', { type: 'button', className: 'dvb-btn' + (mode === 'raw' ? ' is-on' : ''), onClick() { setMode('raw'); setSerial((p) => ({ ...p, error: '' })) } }, t('framesRaw') || '原始数据'),
        el('button', { type: 'button', className: 'dvb-btn', onClick: togglePause }, paused ? (t('serialResume') || '恢复') : (t('serialPause') || '暂停')),
        el('button', { type: 'button', className: 'dvb-btn', disabled: !filtered.length, onClick: copyFrames }, copied === 'copy' ? (t('serialCopied') || '已复制') : (t('framesCopyHex') || '复制')),
        el('button', { type: 'button', className: 'dvb-btn', disabled: !filtered.length, onClick: exportFrames }, t('framesExport') || '导出'),
        mode === 'raw' ? el('button', { type: 'button', className: 'dvb-btn', disabled: !sel || sel.kind === 'all', onClick() {
          const p = sel && sel.kind === 'raw' ? sel.port : (sel && sel.kind === 'conn' ? '' : '')
          if (!realCwd || !p) return
          post('/dsh-vision-bench/serial/open', { cwd: realCwd, port: p, baudrate: 115200 }, 15000).then((data) => {
            if (data && data.ok === false && /PORT_IN_USE|占用/.test(data.error || '')) setSerial((pp) => ({ ...pp, error: data.error }))
            else setSerial((pp) => ({ ...pp, open: true, port: p, error: '' }))
          }).catch((e) => setSerial((pp) => ({ ...pp, error: String(e && e.message || 'fail') })))
        } }, t('serialOpen') || '打开串口') : null,
        mode === 'raw' && serial.open ? el('button', { type: 'button', className: 'dvb-btn', onClick() {
          post('/dsh-vision-bench/serial/close', { cwd: realCwd }).catch(() => {})
          setSerial((pp) => ({ ...pp, open: false, lines: [] }))
        } }, t('serialClose') || '关闭') : null,
        mode === 'proto' ? el('button', { type: 'button', className: 'dvb-btn', onClick: clearView }, t('framesClear') || '清空') : null
      ),
      el('div', { className: 'dvb-toolbar' },
        el('select', { className: 'dvb-input', value: selection, onChange: (e) => { setSelection(e.target.value); isAtBottomRef.current = true } },
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
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      !filtered.length ? el('div', { className: 'dvb-hint' }, t('framesEmpty') || '暂无报文') : null,
      newRowsHint && !paused ? el('div', { className: 'dvb-hint', onClick: scrollToLatest, role: 'button' }, newRowsHint + ' · 点击回到底部') : null,
      el('div', { className: 'dvb-live-list dvb-frames-virtual', style: { height: '320px', overflowY: 'auto', position: 'relative' }, ref: listRef, onScroll: () => countScroll() },
        el('div', { style: { height: totalHeight + 'px', position: 'relative', width: '100%' } },
          (virtualRows || []).map((item) => {
            const f = filtered[item.index]
            if (!f) return null
            const fid = f.frameId || f.id
            return el('div', {
              key: fid !== undefined ? String(fid) : String(item.index),
              className: 'dvb-live-row',
              ref: vendorVirtualizer && vizerRef.current ? vizerRef.current.measureElement : undefined,
              'data-index': item.index,
              'data-frameid': fid !== undefined ? String(fid) : '',
              style: { position: 'absolute', top: 0, left: 0, width: '100%', transform: 'translateY(' + item.start + 'px)' },
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