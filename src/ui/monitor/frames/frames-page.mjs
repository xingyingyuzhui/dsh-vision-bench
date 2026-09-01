import { normalizeModbus } from '../../../../bench-devices.mjs'
import {
  buildFramePortOptions,
  countAddedFrameIds,
  frameStreamKey,
  framesShouldStickToBottom,
  mergeFramesDedup,
  parseFramePortSelection,
  rawLineId,
  resolveFrameSelection,
  selectProtocolFrames,
} from '../../../../bench-frames-model.mjs'
import {
  buildAgentRef,
  copyAgentRef,
  dispatchAgentRef,
  getFramesLog,
  hasHarnessInput,
} from '../../../../bench-shared.mjs'
import { buildInputBridge, evidenceFromRef, postEvidence, readInputDraft } from '../../../../bench-shared.mjs'
import { vendorUseVirtualizer, vendorVirtualizer } from '../../../../bench-vendor.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createDataTable } from '../../components/data-table.mjs'
import { filterFrameList } from './frames-filter-model.mjs'

// 串口报文侧栏：只订阅上位机已连接串口的协议/原始捕获，不打开 COM。
export const FRAMES_TAB_ID = 'dsh-vision-bench:frames'

const ESTIMATE_SIZE = 36
const OVERS_CAN = 10

// Task2/0.18.2: official React virtualizer adapter. `useViz` is stable across
// renders (module scope), so this is a legal unconditional hook call.
// lazy: vendor only exists after the ModuleLoader factory runs (or late global install in tests)
const useViz = vendorUseVirtualizer() || (() => null)

export function createFramesPage(React, t, post, hooks) {
  // Task8/0.18.3: the virtualizer hook is injected ONCE per page factory —
  // tests pass the official adapter explicitly, production uses DvbVendor's.
  const useVizForPage = (hooks && typeof hooks.useVirtualizer === 'function' && hooks.useVirtualizer) || useViz
  const DataTable = createDataTable(React)
  return function FramesPage(props) {
    const el = React.createElement
    // Task5/0.18.2: hook reads at render top-level, passed into the pure dispatch bridge
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const realCwd = sessionCwd(props)
    const sessionId = pageSessionId(props)
    const [health, setHealth] = React.useState({})
    const [modbus, setModbus] = React.useState({
      version: 3,
      connections: [],
      devices: [],
      points: [],
      framesByConnection: {},
    })
    const [ports, setPorts] = React.useState([])
    const [selection, setSelection] = React.useState('all')
    const [mode, setMode] = React.useState('proto')
    const [filters, setFilters] = React.useState({ deviceId: '', functionCode: '', status: '', source: '' })
    const [showFilters, setShowFilters] = React.useState(false)
    const [search, setSearch] = React.useState('')
    const [paused, setPaused] = React.useState(false)
    const [serial, setSerial] = React.useState({ lines: [], lastId: 0, lastAt: 0, error: '' })
    const [serialSources, setSerialSources] = React.useState([])
    const [viewClearedAt, setViewClearedAt] = React.useState(0)
    const [selectedFrameId, setSelectedFrameId] = React.useState('')
    const [copied, setCopied] = React.useState('')
    const [liveEpoch, setLiveEpoch] = React.useState(0) // bump when new frames collected
    const [pendingNew, setPendingNew] = React.useState(0) // 新增数量（非总量）
    const [pausedSnapshot, setPausedSnapshot] = React.useState(null) // {proto: [], raw: []}
    const listRef = React.useRef(null)
    const vizerRef = React.useRef(null)
    const wasAtBottomRef = React.useRef(true)
    const cursorRef = React.useRef(new Map())
    const lastAtBottomRef = React.useRef(true)

    React.useEffect(() => {
      setHealth({})
      setModbus({ version: 3, connections: [], devices: [], points: [], framesByConnection: {} })
      setPorts([])
      setSerial({ lines: [], lastId: 0, lastAt: 0, error: '' })
      setSerialSources([])
      setPausedSnapshot(null)
      setPendingNew(0)
    }, [realCwd, sessionId])

    // state polling → persisted framesByConnection + memory merge (Task3 live collection)
    React.useEffect(() => {
      if (!realCwd) return undefined
      let stop = false
      const timer = setInterval(async () => {
        try {
          const data = await post('/dsh-vision-bench/state', { cwd: realCwd, sessionId: sessionId || undefined })
          if (stop) return
          if (data?.health) setHealth(data.health)
          const mb = data?.workspace?.modbus
          if (mb) setModbus((prev) => ({ ...prev, ...mb }))
          if (Array.isArray(data.serialSources)) setSerialSources(data.serialSources)
          setLiveEpoch((n) => n + 1)
        } catch {}
      }, 1200)
      return () => {
        stop = true
        clearInterval(timer)
      }
    }, [realCwd, sessionId])

    React.useEffect(() => {
      if (mode !== 'raw' || !realCwd) return undefined
      let stop = false
      const timer = setInterval(() => {
        const selNow = parseFramePortSelection(selection)
        post(
          '/dsh-vision-bench/serial/feed',
          {
            cwd: realCwd,
            sessionId: sessionId || undefined,
            connectionId: selNow.kind === 'conn' ? selNow.connectionId : '',
            since: selNow.kind === 'conn' ? serial.lastId : serial.lastAt,
          },
          10000,
        )
          .then((data) => {
            if (stop || !data) return
            const incoming = Array.isArray(data.lines) ? data.lines : []
            setSerial((prev) => {
              const seen = new Set()
              const lines = []
              for (const l of prev.lines.concat(incoming)) {
                const id = rawLineId(l.port, l, 0)
                if (seen.has(id)) continue
                seen.add(id)
                lines.push(l)
              }
              const lastAt = lines.reduce((m, l) => Math.max(m, Number(l.at || l.t || 0)), prev.lastAt || 0)
              return {
                ...prev,
                lastId: data.lastId || prev.lastId,
                lastAt,
                lines: lines.slice(-2000),
                error: data.error || '',
              }
            })
            setLiveEpoch((n) => n + 1)
          })
          .catch(() => {})
      }, 700)
      return () => {
        stop = true
        clearInterval(timer)
      }
    }, [realCwd, sessionId, mode, serial.lastId, selection])

    const pack = (() => {
      try {
        return normalizeModbus(modbus)
      } catch {
        return { connections: [], devices: [], points: [], framesByConnection: {} }
      }
    })()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []
    const framesByConnection = pack?.framesByConnection || {}
    const sel = resolveFrameSelection(selection, connections)
    const portOptions = buildFramePortOptions(connections, ports, mode, serialSources)

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
      if (viewClearedAt > 0) liveFrames = liveFrames.filter((f) => (f.t || f.at || 0) > viewClearedAt)
    } else {
      liveFrames = serial.lines.map((l, idx) => ({
        t: l.at || l.t,
        at: l.at || l.t,
        request: l.hex || l.text || l.line || '',
        response: '',
        hex: l.hex,
        bytes: l.byteLength || l.bytes,
        id: rawLineId(l.port, l, idx),
        frameId: rawLineId(l.port, l, idx),
        label: (l.hex || '').slice(0, 24),
        direction: l.direction || 'rx',
        status: 'ok',
        connectionId: l.connectionId || sel.connectionId || '',
        port: l.port,
        source: l.source || '',
        deviceId: '',
        functionCode: 0,
      }))
      if (viewClearedAt > 0) liveFrames = liveFrames.filter((f) => (f.t || f.at || 0) > viewClearedAt)
    }

    // Task6/0.18.3: display snapshot ONLY from state — no setState during render
    const displayedFrames = paused && pausedSnapshot ? pausedSnapshot[mode] || [] : liveFrames

    // filters + search run on the DISPLAYED layer
    const filtered = filterFrameList(displayedFrames, filters, search)

    // Task5+6/0.18.3: per-stream idle/added accounting with FULL previous-id sets.
    // Cursors are keyed by mode|selection so COM/connection/mode never pollute
    // each other; the first observation of a stream is a pure baseline.
    const streamKey = frameStreamKey(mode, selection)
    const liveIds = liveFrames.map((f) => String(f.frameId || f.id || ''))
    React.useEffect(() => {
      const cursors = cursorRef.current
      const cur = cursors.get(streamKey)
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

    // Task5/0.18.4: the ONE exit path for the paused state — every flow that
    // leaves pause (clear / switch stream / switch mode / close serial / cwd
    // change / invalid selection) must go through here, never partial clears.
    function exitPausedState(opts = {}) {
      const { resetCursor = false, followLatest = false } = opts
      if (resetCursor) resetCursors()
      else {
        const cursors = cursorRef.current
        const cur = cursors.get(streamKey)
        if (cur) {
          cur.pausedAnchor = null
          cur.anchor = new Set(liveIds)
        }
        setPendingNew(0)
      }
      setPaused(false)
      setPausedSnapshot(null)
      if (followLatest && (wasAtBottomRef.current || lastAtBottomRef.current)) {
        setTimeout(() => scrollToLatest(false), 40)
      }
    }

    // Task5/0.18.4: any stream change while paused must exit through the unified
    // path — no half-state (paused=true, snapshot=null).
    React.useEffect(() => {
      if (paused) exitPausedState({ resetCursor: true })
      setSerial((s) => ({ ...s, lines: [], lastId: 0, lastAt: 0, error: '' }))
      setViewClearedAt(0)
      setSelectedFrameId('')
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [selection, mode])
    React.useEffect(() => {
      if (paused) exitPausedState({ resetCursor: true })
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [realCwd, streamKey])

    function scrollToLatest(updateRef = true) {
      const el = listRef.current
      const inst = vizerRef.current
      // Prefer offset scroll: scrollToIndex retries warn under dynamic measureElement
      // when DOM row heights are approximate (happy-dom / first paint).
      if (inst && typeof inst.scrollToOffset === 'function') {
        const viewH = el?.clientHeight || 320
        const total = typeof inst.getTotalSize === 'function' ? inst.getTotalSize() : filtered.length * ESTIMATE_SIZE
        inst.scrollToOffset(Math.max(0, total - viewH), { align: 'start' })
      } else if (el) {
        el.scrollTop = el.scrollHeight || filtered.length * ESTIMATE_SIZE
      }
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
        exitPausedState({ followLatest: true })
      }
      setPaused(next)
    }

    // Task3+4/0.18.4: mode switching — leaving raw must first close an owned
    // monitor; only after a confirmed close may proto take over. Closing or
    // opening in flight blocks rapid toggling.
    function switchMode(nextMode) {
      if (nextMode === mode) return
      setSerial((s) => ({ ...s, error: '' }))
      exitPausedState({ resetCursor: true })
      setMode(nextMode)
    }

    function clearView() {
      // 清空显示只重置本页，不影响连接和插件历史缓存。
      exitPausedState({ resetCursor: true })
      setViewClearedAt(Date.now())
      setSerial((s) => ({ ...s, lines: [], lastId: 0, lastAt: 0 }))
      setSelectedFrameId('')
    }
    const [error, setError] = React.useState('')

    async function sendToAgent(frame) {
      if (mode === 'raw') {
        const text = [
          `port: ${frame.port || ''}`,
          `t: ${String(frame.t || frame.at || '')}`,
          `id: ${String(frame.id || '')}`,
          `hex: ${String(frame.hex || '')}`,
          `text: ${String(frame.text || frame.line || '')}`,
        ].join('\n')
        try {
          navigator.clipboard.writeText(text).then(() => {
            setCopied('copy')
            setTimeout(() => setCopied(''), 1500)
          })
        } catch {}
        return
      }
      const configVersion = Number(pack.configVersion) > 0 ? Number(pack.configVersion) : null
      if (!configVersion) {
        setCopied('no-version')
        setTimeout(() => setCopied(''), 2000)
        return
      }
      // Task4: typed evidence reference — kind frame with frameId, not id-as-point
      const ref = buildAgentRef(
        'frame',
        {
          frameId: frame.frameId || frame.id,
          connectionId: frame.connectionId,
          deviceId: frame.deviceId,
          label: frame.label,
          transactionId: frame.transactionId,
        },
        {
          configVersion,
          start: (frame.t || frame.at || Date.now()) - 5 * 60 * 1000,
          end: frame.t || frame.at || Date.now(),
        },
      )
      const res = await dispatchAgentRef(ref, agentBridge)
      const labelByMode = { input: '已加入输入框', sent: '已发送', copied: '已复制组件引用', failed: '复制失败' }
      setCopied(labelByMode[res?.mode || 'failed'] || res?.status || '复制失败')
      setTimeout(() => setCopied(''), 2000)
      // Task4/0.18.2: evidence append must surface CONFIG_DRIFT/TARGET_MISMATCH, never silent
      postEvidence(post, realCwd, evidenceFromRef(ref), (reason) => {
        setError(reason)
        // reference already entered the input — keep the ref text visible
        try {
          copyAgentRef(ref)
        } catch {}
      })
    }

    function copyFrames() {
      const text = filtered
        .map(
          (f) =>
            `[${new Date(f.t || f.at).toLocaleTimeString()}] ${f.direction || 'tx'} ${f.request || ''} ${f.response ? `← ${f.response}` : ''} ${f.connectionId || ''}`,
        )
        .join('\n')
      if (!text) return
      try {
        navigator.clipboard.writeText(text).then(() => {
          setCopied('copy')
          setTimeout(() => setCopied(''), 1500)
        })
      } catch {}
    }
    function exportFrames() {
      const blob = filtered.map((f) => JSON.stringify(f)).join('\n')
      if (!blob) return
      try {
        navigator.clipboard.writeText(blob).then(() => {
          setCopied('export')
          setTimeout(() => setCopied(''), 1500)
        })
      } catch {}
    }

    const banner =
      !paused && pendingNew > 0
        ? `有 ${pendingNew} 条新报文 · 点击回到底部`
        : paused
          ? `已暂停${pendingNew > 0 ? `，新增 ${pendingNew} 条` : ''}`
          : ''

    const selectedGone = sel.kind === 'conn' && !serialSources.some((s) => s.connectionId === sel.connectionId)
    const frameColumns =
      mode === 'raw'
        ? [
            {
              id: 'time',
              header: '时间',
              accessorFn: (f) => f.t || f.at,
              cell: (info) =>
                el('span', { className: 'dvb-map-meta' }, new Date(info.getValue() || Date.now()).toLocaleTimeString()),
            },
            { id: 'port', header: '端口', accessorFn: (f) => f.port || f.connectionId || '' },
            {
              id: 'dir',
              header: '方向',
              accessorFn: (f) => f.direction || 'tx',
              cell: (info) => el('span', { className: 'dvb-badge' }, String(info.getValue() || 'tx').toUpperCase()),
            },
            {
              id: 'bytes',
              header: '字节',
              accessorFn: (f) => f.bytes || f.byteLength || (f.hex || '').length / 2 || '',
            },
            { id: 'hex', header: '数据', minSize: 160, accessorFn: (f) => f.hex || f.request || '' },
            {
              id: 'ai',
              header: '',
              enableSorting: false,
              size: 56,
              accessorFn: (f) => f.frameId || f.id,
              cell: (info) =>
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm',
                    title: hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent',
                    onClick(ev) {
                      if (ev?.stopPropagation) ev.stopPropagation()
                      sendToAgent(info.row.original)
                    },
                  },
                  copied === '已加入输入框' ? '已加入' : copied === '已发送' ? '已发送' : 'AI',
                ),
            },
          ]
        : [
            {
              id: 'time',
              header: '时间',
              accessorFn: (f) => f.t || f.at,
              cell: (info) =>
                el('span', { className: 'dvb-map-meta' }, new Date(info.getValue() || Date.now()).toLocaleTimeString()),
            },
            { id: 'port', header: '端口', accessorFn: (f) => f.port || f.connectionId || '' },
            {
              id: 'device',
              header: '设备',
              accessorFn: (f) => {
                const dev = devices.find((d) => d.id === f.deviceId)
                return dev?.name || f.deviceName || f.deviceId || ''
              },
            },
            {
              id: 'unit',
              header: '站号',
              accessorFn: (f) => {
                const dev = devices.find((d) => d.id === f.deviceId)
                return f.unitId || dev?.unitId || '—'
              },
            },
            {
              id: 'fc',
              header: '功能码',
              accessorFn: (f) => f.functionCode,
              cell: (info) => el('span', { className: 'dvb-hint' }, `FC${String(info.getValue() || '')}`),
            },
            {
              id: 'dur',
              header: '耗时',
              accessorFn: (f) => f.durationMs,
              cell: (info) => (info.getValue() != null ? `${info.getValue()}ms` : ''),
            },
            {
              id: 'src',
              header: '来源',
              accessorFn: (f) => f.source,
              cell: (info) => {
                const src = info.getValue()
                return src === 'agent'
                  ? t('framesSrcAgent') || 'Agent'
                  : src === 'polling'
                    ? t('framesSrcPoll') || '自动刷新'
                    : src
                      ? t('framesSrcUser') || '用户'
                      : ''
              },
            },
            {
              id: 'status',
              header: '状态',
              accessorFn: (f) => f.status,
              cell: (info) => {
                const status = info.getValue()
                return el(
                  'span',
                  { className: 'dvb-badge', 'data-kind': status === 'ok' ? 'ready' : 'err' },
                  status === 'ok' ? '成功' : status || '失败',
                )
              },
            },
            {
              id: 'ai',
              header: '',
              enableSorting: false,
              size: 56,
              accessorFn: (f) => f.frameId || f.id,
              cell: (info) =>
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm',
                    title: hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent',
                    onClick(ev) {
                      if (ev?.stopPropagation) ev.stopPropagation()
                      sendToAgent(info.row.original)
                    },
                  },
                  copied === '已加入输入框' ? '已加入' : copied === '已发送' ? '已发送' : 'AI',
                ),
            },
          ]

    return el(
      'div',
      { className: 'dvb-live dvb-frames-page', 'data-mode': mode },
      el(
        'div',
        { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('framesTab') || '串口报文'),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${mode === 'proto' ? ' is-on' : ''}`,
            onClick() {
              switchMode('proto')
            },
          },
          t('framesProto') || '协议报文',
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${mode === 'raw' ? ' is-on' : ''}`,
            onClick() {
              switchMode('raw')
            },
          },
          t('framesRaw') || '原始数据',
        ),
        el(
          'button',
          { type: 'button', className: 'dvb-btn', onClick: togglePause },
          paused ? t('serialResume') || '恢复' : t('serialPause') || '暂停',
        ),
        el('button', { type: 'button', className: 'dvb-btn', onClick: clearView }, t('framesClearView') || '清空显示'),
        el(
          'button',
          { type: 'button', className: 'dvb-btn', disabled: !filtered.length, onClick: exportFrames },
          t('framesExport') || '导出',
        ),
      ),
      selectedGone
        ? el(
            'div',
            { className: 'dvb-hint' },
            el(
              'div',
              null,
              `${sel.port || sel.connectionId} ${t('framesDisconnected') || '已断开，已停止接收新报文。历史报文仍可查看。'}`,
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                onClick() {
                  setSelection('all')
                },
              },
              t('framesPickOther') || '选择其他串口',
            ),
          )
        : null,
      el(
        'div',
        { className: 'dvb-toolbar' },
        el(
          'select',
          {
            className: 'dvb-input',
            value: selection,
            onChange: (e) => {
              setSelection(e.target.value)
              setPendingNew(0)
            },
          },
          portOptions.map((o) => el('option', { key: o.value, value: o.value }, o.label)),
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            onClick() {
              setShowFilters((v) => !v)
            },
          },
          t('framesFilters') || '筛选',
        ),
        el('input', {
          className: 'dvb-input',
          value: search,
          placeholder: t('serialFilter') || '搜索报文……',
          onChange: (e) => setSearch(e.target.value),
        }),
      ),
      showFilters && mode === 'proto'
        ? el(
            'div',
            { className: 'dvb-toolbar' },
            el(
              'select',
              {
                className: 'dvb-input',
                value: filters.deviceId,
                onChange: (e) => setFilters((p) => ({ ...p, deviceId: e.target.value })),
              },
              el('option', { value: '' }, '全部设备'),
              devices.map((d) => el('option', { key: d.id, value: d.id }, `${d.name} · 站号 ${d.unitId}`)),
            ),
            el(
              'select',
              {
                className: 'dvb-input',
                value: filters.functionCode,
                onChange: (e) => setFilters((p) => ({ ...p, functionCode: e.target.value })),
              },
              el('option', { value: '' }, '全部功能码'),
              [1, 2, 3, 4, 5, 6, 15, 16].map((fc) => el('option', { key: String(fc), value: String(fc) }, `FC${fc}`)),
            ),
            el(
              'select',
              {
                className: 'dvb-input',
                value: filters.status,
                onChange: (e) => setFilters((p) => ({ ...p, status: e.target.value })),
              },
              el('option', { value: '' }, '全部状态'),
              el('option', { value: 'ok' }, '成功'),
              el('option', { value: 'err' }, '失败'),
            ),
            el(
              'select',
              {
                className: 'dvb-input',
                value: filters.source,
                onChange: (e) => setFilters((p) => ({ ...p, source: e.target.value })),
              },
              el('option', { value: '' }, '全部来源'),
              el('option', { value: 'manual' }, '用户'),
              el('option', { value: 'polling' }, '自动刷新'),
              el('option', { value: 'agent' }, 'Agent'),
            ),
          )
        : null,
      serial.error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, serial.error) : null,
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      !filtered.length && vendorVirtualizer() === null
        ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, '虚拟列表依赖未加载')
        : null,
      !filtered.length ? el('div', { className: 'dvb-hint' }, t('framesEmpty') || '暂无报文') : null,
      banner
        ? el('div', { className: 'dvb-hint dvb-new-banner', onClick: () => scrollToLatest(), role: 'button' }, banner)
        : null,
      el(DataTable, {
        data: filtered,
        columns: frameColumns,
        getRowId: (f) => String(f.frameId || f.id || ''),
        virtualize: true,
        useVirtualizer: useVizForPage,
        estimateSize: ESTIMATE_SIZE,
        overscan: OVERS_CAN,
        height: 320,
        fallbackCap: 30,
        listRef,
        listClassName: 'dvb-live-list dvb-frames-virtual',
        selectedId: selectedFrameId,
        onRowClick(f) {
          setSelectedFrameId(String(f.frameId || f.id || ''))
        },
        onVirtualizer(inst) {
          vizerRef.current = inst
        },
        onVirtualizerChange() {
          const el2 = listRef.current
          if (el2) {
            const atBottom = framesShouldStickToBottom(el2.scrollTop, el2.scrollHeight, el2.clientHeight)
            wasAtBottomRef.current = atBottom
            lastAtBottomRef.current = atBottom
          }
        },
        onScroll() {
          const el2 = listRef.current
          if (el2) wasAtBottomRef.current = framesShouldStickToBottom(el2.scrollTop, el2.scrollHeight, el2.clientHeight)
        },
        getRowProps(row) {
          return {
            className: `dvb-live-row${String(row.id) === String(selectedFrameId) ? ' is-on' : ''}`,
            'data-frameid': row.id ? String(row.id) : '',
          }
        },
      }),
      (() => {
        const f = filtered.find((row) => String(row.frameId || row.id) === String(selectedFrameId))
        if (!f) return null
        const srcLabel = f.source === 'agent' ? 'Agent' : f.source === 'polling' ? '自动刷新' : '用户'
        return el(
          'div',
          { className: 'dvb-panel' },
          el('div', { className: 'dvb-hint' }, `发送：${f.request || f.hex || ''}`),
          f.response ? el('div', { className: 'dvb-hint' }, `接收：${f.response}`) : null,
          el('div', { className: 'dvb-hint' }, `来源：${srcLabel}`),
          el('div', { className: 'dvb-hint' }, `事务：${f.transactionId || f.frameId || ''}`),
          f.sessionId ? el('div', { className: 'dvb-hint' }, `sessionId：${f.sessionId}`) : null,
          f.toolCallId ? el('div', { className: 'dvb-hint' }, `toolCallId：${f.toolCallId}`) : null,
        )
      })(),
      el(
        'div',
        { className: 'dvb-hint' },
        mode === 'raw'
          ? t('framesRawHint') || '原始串口字节流'
          : t('framesProtoHint') || 'Modbus 事务报文 · TCP 显示协议归一化报文，不是原始 MBAP',
      ),
    )
  }
}
