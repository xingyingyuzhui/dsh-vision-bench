import { normalizeModbus } from '../../../application/modbus/modbus-migration.mjs'
import {
  buildFramePortOptions,
  countAddedFrameIds,
  frameStreamKey,
  framesShouldStickToTop,
  resolveFrameSelection,
} from '../../../domain/modbus/frames-model.mjs'
import {
  buildAgentRef,
  buildInputBridge,
  copyAgentRef,
  dispatchAgentRef,
  evidenceFromRef,
  postEvidence,
  readInputDraft,
} from '../../common/agent-reference.mjs'
import { pageSessionId, sessionCwd } from '../../common/session-scope.mjs'
import { subscribeState } from '../../common/state-subscription.mjs'
import { filterFrameList, sortFramesNewestFirst } from './frames-filter-model.mjs'
import {
  buildLiveFrames,
  downloadFramesFile,
  framesAsJson,
  framesAsText,
  pickDisplayedFrames,
} from './frames-table-model.mjs'
import { startRawFeedPolling } from './raw-feed-polling.mjs'

const ESTIMATE_SIZE = 36

function emptyModbus() {
  return {
    version: 3,
    connections: [],
    devices: [],
    points: [],
    framesByConnection: {},
  }
}

/**
 * Session query/state for the frames monitor page: subscriptions, live/raw
 * feeds, pause/clear/export, selection sync, and agent hand-off.
 *
 * @param {any} React
 * @param {any} props
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 */
export function useFramesPage(React, props, post) {
  const inputDraft = readInputDraft(props?.useInput)
  const agentBridge = buildInputBridge(props, inputDraft)
  const realCwd = sessionCwd(props)
  const sessionId = pageSessionId(props)

  const [health, setHealth] = React.useState({})
  const [modbus, setModbus] = React.useState(emptyModbus)
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
  const [, setPendingNew] = React.useState(0)
  const [pausedSnapshot, setPausedSnapshot] = React.useState(null)
  const [error, setError] = React.useState('')

  const listRef = React.useRef(null)
  const vizerRef = React.useRef(null)
  const wasAtBottomRef = React.useRef(true)
  const cursorRef = React.useRef(new Map())
  const lastAtBottomRef = React.useRef(true)
  const rawCursorRef = React.useRef(0)
  const feedEpochRef = React.useRef('')

  React.useEffect(() => {
    setHealth({})
    setModbus(emptyModbus())
    setPorts([])
    setSerial({ lines: [], lastId: 0, lastAt: 0, error: '' })
    setSerialSources([])
    setPausedSnapshot(null)
    setPendingNew(0)
    rawCursorRef.current = 0
    feedEpochRef.current = ''
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
      feedEpochRef.current = ''
      return undefined
    }
    return startRawFeedPolling({
      post,
      realCwd,
      sessionId,
      selection,
      rawCursorRef,
      feedEpochRef,
      setSerial,
    })
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

  const isShared = Boolean(modbus?.share?.enabled && modbus?.share?.connections)
  const frameScope = { cwd: realCwd, sessionId, isShared }
  const liveFrames = buildLiveFrames({
    mode,
    sel,
    framesByConnection,
    frameScope,
    serial,
    connections,
    viewClearedAt,
  })
  const displayedFrames = pickDisplayedFrames(paused, pausedSnapshot, mode, liveFrames)
  const filtered = sortFramesNewestFirst(
    filterFrameList(
      displayedFrames,
      mode === 'raw' ? { direction: filters.direction || '' } : filters,
      search,
    ),
  )

  const streamKey = frameStreamKey(mode, selection)
  const liveIds = liveFrames.map((f) => String(f.frameId || f.id || ''))
  const liveIdKey = liveIds.join('|')

  function resetCursors() {
    cursorRef.current.clear()
    setPendingNew(0)
  }

  function scrollToLatest(updateRef = true) {
    const el = listRef.current
    const inst = vizerRef.current
    if (inst && typeof inst.scrollToOffset === 'function') {
      inst.scrollToOffset(0, { align: 'start' })
    } else if (el) {
      el.scrollTop = 0
    }
    if (updateRef) wasAtBottomRef.current = true
    setPendingNew(0)
  }

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

  React.useEffect(() => {
    const cursors = cursorRef.current
    const cur = cursors.get(streamKey)
    if (!cur) {
      cursors.set(streamKey, { anchor: new Set(liveIds), pausedAnchor: null })
      setPendingNew(0)
      return
    }
    if (paused) {
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
    if (added > 0 && wasAtBottomRef.current) {
      requestAnimationFrame(() => scrollToLatest(false))
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [liveIdKey, streamKey, paused])

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

  function togglePause() {
    const next = !paused
    if (next) {
      const snap = displayedFrames.map((f) => ({ ...f }))
      setPausedSnapshot({ [mode]: snap })
      const cursors = cursorRef.current
      const cur = cursors.get(streamKey)
      if (cur) cur.pausedAnchor = new Set(liveIds)
    } else {
      exitPausedState({ followLatest: true })
    }
    setPaused(next)
  }

  function switchMode(nextMode) {
    if (nextMode === mode) return
    setSerial((s) => ({ ...s, error: '' }))
    exitPausedState({ resetCursor: true })
    setMode(nextMode)
  }

  function clearView() {
    exitPausedState({ resetCursor: true })
    setViewClearedAt(Date.now())
    rawCursorRef.current = 0
    setSerial((s) => ({ ...s, lines: [], lastId: 0, lastAt: 0 }))
    setSelectedFrameId('')
  }

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
    postEvidence(post, realCwd, evidenceFromRef(ref), (reason) => {
      setError(reason)
      try {
        copyAgentRef(ref)
      } catch {}
    })
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
    const text = kind === 'json' ? framesAsJson(filtered) : framesAsText(filtered, connections)
    if (!downloadFramesFile(kind, text)) return
    setExportOpen(false)
  }

  function copyFrames() {
    copyText(framesAsText(filtered, connections), 'copy')
    setExportOpen(false)
  }

  function exportFrames() {
    copyText(framesAsJson(filtered), 'export')
    setExportOpen(false)
  }

  const selectedGone = sel.kind === 'conn' && !serialSources.some((s) => s.connectionId === sel.connectionId)
  const selectedFrame = filtered.find((row) => String(row.frameId || row.id) === String(selectedFrameId)) || null
  const filteredIds = filtered.map((row) => String(row.frameId || row.id || '')).join('|')

  React.useEffect(() => {
    if (!filtered.length) {
      if (selectedFrameId) setSelectedFrameId('')
      return
    }
    if (filtered.some((row) => String(row.frameId || row.id) === String(selectedFrameId))) return
    const newest = filtered[0]
    setSelectedFrameId(String(newest.frameId || newest.id || ''))
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [filteredIds, selectedFrameId])

  function resetFilters() {
    setFilters({ deviceId: '', functionCode: '', status: '', source: '', direction: '' })
    setSearch('')
    setSelection('all')
    setPendingNew(0)
  }

  function noteScrollPosition() {
    const el2 = listRef.current
    if (el2) {
      const atLatest = framesShouldStickToTop(el2.scrollTop)
      wasAtBottomRef.current = atLatest
      lastAtBottomRef.current = atLatest
    }
  }

  function onScroll() {
    const el2 = listRef.current
    if (el2) wasAtBottomRef.current = framesShouldStickToTop(el2.scrollTop)
  }

  return {
    health,
    mode,
    encoding,
    setEncoding,
    paused,
    selection,
    setSelection,
    setPendingNew,
    portOptions,
    search,
    setSearch,
    filters,
    setFilters,
    devices,
    connections,
    filtered,
    selectedFrameId,
    setSelectedFrameId,
    selectedFrame,
    selectedGone,
    sel,
    serial,
    error,
    copied,
    exportOpen,
    setExportOpen,
    listRef,
    vizerRef,
    switchMode,
    togglePause,
    clearView,
    resetFilters,
    sendToAgent,
    downloadFrames,
    copyFrames,
    exportFrames,
    noteScrollPosition,
    onScroll,
    estimateSize: ESTIMATE_SIZE,
  }
}
