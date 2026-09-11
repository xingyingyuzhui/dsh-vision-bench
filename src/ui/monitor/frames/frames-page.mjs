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
  formatErrorMessage,
  getFramesLog,
  hasHarnessInput,
  subscribeState,
} from '../../../../bench-shared.mjs'

import { buildInputBridge, evidenceFromRef, postEvidence, readInputDraft } from '../../../../bench-shared.mjs'
import { vendorUseVirtualizer, vendorVirtualizer } from '../../../../bench-vendor.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { createDataTable } from '../../components/data-table.mjs'
import { buildFrameColumns } from './frames-columns.mjs'
import { createFramesDetailDrawer } from './frames-detail-drawer.mjs'
import { filterFrameList } from './frames-filter-model.mjs'
import { createFramesFilterToolbar } from './frames-filter-toolbar.mjs'
import {
  formatFrameClock,
  formatHexDisplay,
  formatPortName,
  frameDirection,
  framePayloadHex,
} from './frames-format.mjs'
import { useFrameColWidths } from './use-frame-col-widths.mjs'

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
  const FramesFilterToolbar = createFramesFilterToolbar(React, t)
  const FramesDetailDrawer = createFramesDetailDrawer(React)
  return function FramesPage(props) {
    const el = React.createElement
    const { colWidths, onStartResize, resetColWidth, totalTableWidth } = useFrameColWidths(React)
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
    const [filters, setFilters] = React.useState({
      deviceId: '',
      functionCode: '',
      status: '',
      source: '',
      direction: '',
    })
    const [encoding, setEncoding] = React.useState('hex')
    const [search, setSearch] = React.useState('')
    const [paused, setPaused] = React.useState(false)
    const [serial, setSerial] = React.useState({ lines: [], lastId: 0, lastAt: 0, error: '' })
    const [serialSources, setSerialSources] = React.useState([])
    const [viewClearedAt, setViewClearedAt] = React.useState(0)
    const [selectedFrameId, setSelectedFrameId] = React.useState('')
    const [copied, setCopied] = React.useState('')
    const [exportOpen, setExportOpen] = React.useState(false)
    const [, setPendingNew] = React.useState(0) // 新增数量（非总量）
    const [pausedSnapshot, setPausedSnapshot] = React.useState(null) // {proto: [], raw: []}
    const listRef = React.useRef(null)
    const vizerRef = React.useRef(null)
    const wasAtBottomRef = React.useRef(true)
    const cursorRef = React.useRef(new Map())
    const lastAtBottomRef = React.useRef(true)
    const rawCursorRef = React.useRef(0)

    React.useEffect(() => {
      setHealth({})
      setModbus({ version: 3, connections: [], devices: [], points: [], framesByConnection: {} })
      setPorts([])
      setSerial({ lines: [], lastId: 0, lastAt: 0, error: '' })
      setSerialSources([])
      setPausedSnapshot(null)
      setPendingNew(0)
      rawCursorRef.current = 0
    }, [realCwd, sessionId])

    React.useEffect(() => {
      if (!realCwd) return undefined
      return subscribeState(
        post,
        realCwd,
        (data) => {
          if (!data) return
          if (data.health) setHealth(data.health)
          const mb = data.workspace?.modbus
          if (mb) setModbus((prev) => ({ ...prev, ...mb }))
          if (Array.isArray(data.serialSources)) setSerialSources(data.serialSources)
        },
        { sessionId },
      )
    }, [realCwd, sessionId])

    React.useEffect(() => {
      if (mode !== 'raw' || !realCwd) {
        rawCursorRef.current = 0
        return undefined
      }
      let stop = false
      rawCursorRef.current = 0
      setSerial((s) => ({ ...s, lines: [], lastId: 0, lastAt: 0, error: '' }))
      const pull = () => {
        const selNow = parseFramePortSelection(selection)
        post(
          '/dsh-vision-bench/serial/feed',
          {
            cwd: realCwd,
            sessionId: sessionId || undefined,
            connectionId: selNow.kind === 'conn' ? selNow.connectionId : '',
            since: rawCursorRef.current,
          },
          10000,
        )
          .then((data) => {
            if (stop || !data) return
            const incoming = Array.isArray(data.lines) ? data.lines : []
            const nextCursor = Number(data.lastId)
            if (Number.isFinite(nextCursor) && nextCursor > 0) rawCursorRef.current = nextCursor
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
                lastId: Number.isFinite(nextCursor) && nextCursor > 0 ? nextCursor : prev.lastId,
                lastAt,
                lines: lines.slice(-2000),
                error: data.error || '',
              }
            })
          })
          .catch(() => {})
      }
      pull()
      const timer = setInterval(pull, 700)
      return () => {
        stop = true
        clearInterval(timer)
      }
    }, [realCwd, sessionId, mode, selection])

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
    const isShared = Boolean(modbus?.share?.enabled && modbus?.share?.connections)
    const frameScope = { cwd: realCwd, sessionId, isShared }
    let liveFrames = []
    if (mode === 'proto') {
      if (sel.kind === 'conn') {
        const persistedArray = framesByConnection[sel.connectionId]
        const mem = getFramesLog(frameScope, sel.connectionId)
        liveFrames = mergeFramesDedup(persistedArray, mem, 500)
      } else {
        liveFrames = mergeFramesDedup(selectProtocolFrames(framesByConnection, 'all'), getFramesLog(frameScope), 1000)
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
    const filtered = filterFrameList(
      displayedFrames,
      mode === 'raw' ? { direction: filters.direction || '' } : filters,
      search,
    )

    // Task5+6/0.18.3: per-stream idle/added accounting with FULL previous-id sets.
    // Cursors are keyed by mode|selection so COM/connection/mode never pollute
    // each other; the first observation of a stream is a pure baseline.
    const streamKey = frameStreamKey(mode, selection)
    const liveIds = liveFrames.map((f) => String(f.frameId || f.id || ''))
    const liveIdKey = liveIds.join('|')
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
    }, [liveIdKey, streamKey, paused])

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
      rawCursorRef.current = 0
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

    function framesAsText() {
      return filtered
        .map((f) => {
          const dir = frameDirection(f)
          const hex = formatHexDisplay(framePayloadHex(f))
          return `${formatFrameClock(f.t || f.at)} ${formatPortName(f, connections)} ${dir} ${hex}`
        })
        .join('\n')
    }
    function framesAsJson() {
      return filtered.map((f) => JSON.stringify(f)).join('\n')
    }
    function copyText(text, flag) {
      if (!text) return
      try {
        navigator.clipboard.writeText(text).then(() => {
          setCopied(flag)
          setTimeout(() => setCopied(''), 1500)
        })
      } catch {}
    }
    function downloadFrames(kind) {
      const text = kind === 'json' ? framesAsJson() : framesAsText()
      if (!text) return
      const d = new Date()
      const p = (n) => String(n).padStart(2, '0')
      const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
      const name = kind === 'json' ? `serial-frames-${stamp}.json` : `serial-frames-${stamp}.txt`
      const blob = new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/plain;charset=utf-8' })
      const url = URL.createObjectURL(blob)
      const a = document.createElement('a')
      a.href = url
      a.download = name
      a.click()
      URL.revokeObjectURL(url)
      setExportOpen(false)
    }
    function copyFrames() {
      copyText(framesAsText(), 'copy')
      setExportOpen(false)
    }
    function exportFrames() {
      copyText(framesAsJson(), 'export')
      setExportOpen(false)
    }

    const selectedGone = sel.kind === 'conn' && !serialSources.some((s) => s.connectionId === sel.connectionId)
    const frameColumns = buildFrameColumns(React, t, props, {
      mode,
      devices,
      connections,
      encoding,
      colWidths,
    })
    const selectedFrame = filtered.find((row) => String(row.frameId || row.id) === String(selectedFrameId)) || null
    const filteredIds = filtered.map((row) => String(row.frameId || row.id || '')).join('|')
    React.useEffect(() => {
      if (!filtered.length) {
        if (selectedFrameId) setSelectedFrameId('')
        return
      }
      if (filtered.some((row) => String(row.frameId || row.id) === String(selectedFrameId))) return
      const last = filtered[filtered.length - 1]
      setSelectedFrameId(String(last.frameId || last.id || ''))
      // eslint-disable-next-line react-hooks/exhaustive-deps
    }, [filteredIds, selectedFrameId])
    function resetFilters() {
      setFilters({ deviceId: '', functionCode: '', status: '', source: '', direction: '' })
      setSearch('')
      setSelection('all')
      setPendingNew(0)
    }

    return el(
      'div',
      { className: 'dvb-live dvb-frames-page', 'data-mode': mode },
      el(
        'div',
        { className: 'dvb-frames-tools' },
        el(
          'div',
          { className: 'dvb-frames-seg' },
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
        ),
        el(
          'div',
          { className: 'dvb-frames-seg' },
          el(
            'button',
            {
              type: 'button',
              className: `dvb-btn${encoding === 'hex' ? ' is-on' : ''}`,
              onClick() {
                setEncoding('hex')
              },
            },
            'HEX',
          ),
          el(
            'button',
            {
              type: 'button',
              className: `dvb-btn${encoding === 'text' ? ' is-on' : ''}`,
              onClick() {
                setEncoding('text')
              },
            },
            'Text',
          ),
        ),
        el(
          'label',
          { className: 'dvb-frames-follow' },
          el(
            'button',
            {
              type: 'button',
              role: 'switch',
              'data-action': 'pause',
              className: `dvb-switch${!paused ? ' is-on' : ''}`,
              'aria-checked': paused ? 'false' : 'true',
              title: paused ? t('serialResume') || '恢复' : t('serialPause') || '暂停',
              onClick: togglePause,
            },
            el('span', { className: 'dvb-switch-track' }),
          ),
          el('span', null, '自动滚动'),
        ),
        el('button', { type: 'button', className: 'dvb-btn', onClick: clearView }, t('framesClearView') || '清空显示'),
        el(
          'div',
          { className: 'dvb-frames-export' },
          el(
            'button',
            {
              type: 'button',
              className: `dvb-btn${exportOpen ? ' is-on' : ''}`,
              disabled: !filtered.length,
              onClick: () => setExportOpen((v) => !v),
            },
            t('framesExport') || '导出',
          ),
          exportOpen
            ? el(
                'div',
                { className: 'dvb-frames-export-menu' },
                el(
                  'button',
                  { type: 'button', className: 'dvb-btn', onClick: () => downloadFrames('txt') },
                  '下载 TXT',
                ),
                el(
                  'button',
                  { type: 'button', className: 'dvb-btn', onClick: () => downloadFrames('json') },
                  '下载 JSON',
                ),
                el('button', { type: 'button', className: 'dvb-btn', onClick: copyFrames }, '复制文本'),
                el('button', { type: 'button', className: 'dvb-btn', onClick: exportFrames }, '复制 JSON'),
              )
            : null,
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
      el(FramesFilterToolbar, {
        mode,
        selection,
        setSelection,
        setPendingNew,
        portOptions,
        search,
        setSearch,
        filters,
        setFilters,
        devices,
        onReset: resetFilters,
      }),
      serial.error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, formatErrorMessage(serial.error)) : null,
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, formatErrorMessage(error)) : null,
      copied ? el('div', { className: 'dvb-hint' }, copied) : null,
      !filtered.length && vendorVirtualizer() === null
        ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, '虚拟列表依赖未加载')
        : null,
      el(
        'div',
        { className: 'dvb-frames-split' },
        el(
          'div',
          { className: 'dvb-frames-main' },
          el(DataTable, {
            data: filtered,
            columns: frameColumns,
            getRowId: (f) => String(f.frameId || f.id || ''),
            virtualize: true,
            useVirtualizer: useVizForPage,
            estimateSize: ESTIMATE_SIZE,
            overscan: OVERS_CAN,
            height: 'auto',
            fallbackCap: 30,
            listRef,
            listClassName: 'dvb-live-list dvb-frames-virtual',
            selectedId: selectedFrameId,
            onStartResize,
            resetColWidth,
            totalWidth: totalTableWidth(mode),
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
              if (el2)
                wasAtBottomRef.current = framesShouldStickToBottom(el2.scrollTop, el2.scrollHeight, el2.clientHeight)
            },
            getRowProps(row) {
              return {
                className: `dvb-live-row${String(row.id) === String(selectedFrameId) ? ' is-on' : ''}`,
                'data-frameid': row.id ? String(row.id) : '',
              }
            },
          }),
        ),
        el(FramesDetailDrawer, {
          frame: selectedFrame,
          connections,
          copied,
          sendToAgent,
          hasInput: hasHarnessInput(props),
        }),
      ),
    )
  }
}
