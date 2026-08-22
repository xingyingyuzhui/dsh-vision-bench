import {
  agentRefToText,
  buildAgentRef,
  clearFramesLog,
  clockOf,
  copyAgentRef,
  getFocusState,
  getTempWatch,
  clearTempWatch,
  setTempWatch,
  isFocusTarget,
  focusHighlightClass,
  getFramesLog,
  lineKind,
  pushFramesLog,
  setFocusState,
  shouldStealFocus,
} from './bench-shared.mjs'
import {
  emptyJournal,
  emptyWorkspace,
  journalPanel,
  pickJournal,
  runningOf,
  runningSource,
  statusBar,
  subscribeState,
  useSessionCwd,
  visionCollabBar,
} from './bench-shared.mjs'
import { statusKind } from './bench-settings.mjs'
import { connLabel, normalizeModbus } from './bench-devices.mjs'
import {
  csvToPoints,
  decodeValue,
  functionTag,
  isWritableFunction,
  normalizeWriteValues,
  pointsToCsv,
} from './bench-points.mjs'

const POLL_INTERVALS = [500, 1000, 2000, 5000]

function fnOptionLabel(t, fn) {
  const key = fn === 1 ? 'fnCoil' : fn === 2 ? 'fnDiscrete' : fn === 4 ? 'fnInput' : 'fnHolding'
  return t(key) + (isWritableFunction(fn) ? ' ' + t('writableTag') : '')
}

function hmiGenId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}

export function createHmiView(React, t, post, openLive) {
  return function HmiView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = (props && props.sessionId) || ''
    const [health, setHealth] = React.useState({})
    const [workspace, setWorkspace] = React.useState(emptyWorkspace)
    const [journal, setJournal] = React.useState(emptyJournal)
    const [busy, setBusy] = React.useState('')
    const [error, setError] = React.useState('')
    const [ports, setPorts] = React.useState([])
    const [scanning, setScanning] = React.useState(false)
    const [pending, setPending] = React.useState([])
    const [form, setForm] = React.useState({ mode: 'hidden', id: '', name: '', function: 3, address: 0, scale: 1, offset: 0, unit: '', alarmMin: '', alarmMax: '' })
    const [batch, setBatch] = React.useState({ open: false, prefix: '', fc: 3, start: 0, count: 5 })
    const [writeRow, setWriteRow] = React.useState(null)
    const [csvOpen, setCsvOpen] = React.useState(false)
    const [csvText, setCsvText] = React.useState('')
    const [csvNote, setCsvNote] = React.useState('')
    const [logMode, setLogMode] = React.useState('serial')
    const [serial, setSerial] = React.useState({ open: false, port: '', baudrate: 115200, lines: [], filter: '', paused: false, error: '', lastId: 0 })
    const [copiedSerial, setCopiedSerial] = React.useState(false)
    const [connForm, setConnForm] = React.useState({ open: false, id: '', name: '', role: 'client', enabled: true, conn: { mode: 'rtu', port: '', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1, host: '', tcpPort: 502, slave: 1, sim: false } })
    const [pendingDeleteId, setPendingDeleteId] = React.useState('')
    const [frameFilter, setFrameFilter] = React.useState('all')
    const [hmiTab, setHmiTab] = React.useState('all')
    const [moreOpen, setMoreOpen] = React.useState(false)
    const [focusState, setFocusUi] = React.useState({ request: null, prev: null, tempWatchIds: [], badgeOnly: false, evidence: [] })
    const [agentCopied, setAgentCopied] = React.useState('')
    const [tempWatchNote, setTempWatchNote] = React.useState('')
    const lastDeviceByConn = React.useRef({})
    const serialRef = React.useRef(serial)
    serialRef.current = serial
    const workspaceRef = React.useRef(workspace)
    workspaceRef.current = workspace
    const inflight = React.useRef(0)

    const field = (label, control) => el('div', { className: 'dvb-row' },
      el('div', { className: 'dvb-label' }, el('span', null, label)),
      control)

    function scanPorts() {
      setScanning(true)
      post('/dsh-vision-bench/serial/ports', {}, 30000).then((data) => {
        setPorts((data && Array.isArray(data.ports)) ? data.ports : [])
      }).catch(() => setPorts([])).finally(() => setScanning(false))
    }

    React.useEffect(() => {
      scanPorts()
    }, [cwd])

    React.useEffect(() => {
      if (!cwd || !serial.open) return undefined
      let stop = false
      const timer = setInterval(() => {
        post('/dsh-vision-bench/serial/feed', { cwd, since: serialRef.current.lastId }, 10000).then((data) => {
          if (stop || !data) return
          setSerial((prev) => ({
            ...prev,
            open: data.open !== false,
            error: data.error || '',
            lastId: data.lastId || prev.lastId,
            lines: Array.isArray(data.lines) && data.lines.length
              ? prev.lines.concat(data.lines).slice(-1000)
              : prev.lines,
          }))
        }).catch(() => { /* next tick retries */ })
      }, 700)
      return () => { stop = true; clearInterval(timer) }
    }, [cwd, serial.open])

    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (!data) return
      if (data.health) setHealth(data.health)
      if (Array.isArray(data.pendingWrites)) setPending(data.pendingWrites)
      setJournal(pickJournal(data))
      if (data.workspace && data.workspace.focus) {
        setFocusUi(data.workspace.focus)
        try { setFocusState(cwd, data.workspace.focus) } catch {}
      }
      if (inflight.current > 0) return
      if (data.workspace && data.workspace.modbus) {
        setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus, focus: data.workspace.focus || prev.focus }))
      }
    }), [cwd])

    function normalizePack() {
      const mb = (workspaceRef.current.modbus) || emptyWorkspace().modbus
      // 兼容 v2 与 v3：v3 含 connections/devices，v2 为单 conn
      try {
        if (mb && mb.version === 3) {
          // normalize via bench-devices to ensure defaults
          return normalizeModbus(mb)
        }
        if (mb && mb.version === 2) {
          // 仍通过 normalizeModbus 迁移到 v3，保证上层统一使用 v3 结构
          return normalizeModbus(mb)
        }
        // 未标记 version 时尝试按 v3 归一化，失败则回退
        if (mb && (Array.isArray(mb.connections) || Array.isArray(mb.devices))) {
          return normalizeModbus(mb)
        }
        return normalizeModbus(mb)
      } catch {
        if (mb && mb.version === 2) return mb
        if (mb && mb.version === 3) return mb
        return emptyWorkspace().modbus
      }
    }

    function persist(modbusPatch) {
      if (!cwd) return Promise.resolve()
      const seq = ++inflight.current
      // 乐观更新：按 connId 定向合并，避免闪烁
      setWorkspace((prev) => {
        const next = { ...prev, modbus: { ...prev.modbus } }
        // v3 keys直接合并；v2 legacy conn/polling 按 activeConnId 定向已在 bench-store 处理
        for (const k of Object.keys(modbusPatch)) {
          if (k === 'connections' || k === 'devices' || k === 'points' || k === 'values' || k === 'pollingByConnection' || k === 'framesByConnection' || k === 'activeConnectionId' || k === 'activeDeviceId' || k === 'alarmState' || k === 'alarmActive' || k === 'version') {
            next.modbus[k] = modbusPatch[k]
          } else if (k === 'conn' || k === 'polling') {
            // 保留给 bench-store 做定向映射，本地也做一份便于立即显示
            if (k === 'conn') {
              next.modbus.conn = { ...(next.modbus.conn||{}), ...modbusPatch.conn }
            } else {
              next.modbus.polling = { ...(next.modbus.polling||{}), ...modbusPatch.polling }
            }
          } else {
            next.modbus[k] = modbusPatch[k]
          }
        }
        workspaceRef.current = next
        return next
      })
      return post('/dsh-vision-bench/workspace', { cwd, modbus: modbusPatch }).then((data) => {
        if (seq === inflight.current && data && data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus }))
          workspaceRef.current = { ...workspaceRef.current, modbus: data.workspace.modbus }
        }
        if (data) setJournal(pickJournal(data))
        if (data && data.ok === false && data.error) setError(data.error)
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      }).finally(() => {
        if (seq === inflight.current) inflight.current = 0
      })
    }

    function cfgVersion() {
      try { return normalizePack().version || 3 } catch { return 3 }
    }

    function agentRefFor(kind, payload) {
      const pack = normalizePack()
      return buildAgentRef(kind, payload, { configVersion: pack.version || 3 })
    }

    function sendToAgent(kind, payload) {
      const ref = agentRefFor(kind, payload)
      const ok = copyAgentRef(ref)
      setAgentCopied(kind + ':' + (payload && (payload.id || payload.pointId || payload.frameId || payload.connectionId) || ''))
      setTimeout(() => setAgentCopied(''), 2000)
      // Also emit a bench event for evidence back-mount (best effort)
      try {
        const cur = workspaceRef.current
        const ev = { kind: ref.kind, id: ref.pointId || ref.frameId || ref.connectionId || ref.deviceId, connectionId: ref.connectionId, deviceId: ref.deviceId, at: ref.at, version: ref.configVersion }
        const prevFocus = cur.focus || { request: null, prev: null, tempWatchIds: [], evidence: [] }
        const nextEvidence = (prevFocus.evidence || []).concat([ev]).slice(-20)
        // Persist evidence locally (non-blocking)
        post('/dsh-vision-bench/workspace', { cwd, focus: { ...prevFocus, evidence: nextEvidence } }).catch(() => {})
      } catch {}
      return ref
    }

    function requestFocusUi(target, opts) {
      if (!cwd) return
      const pack = normalizePack()
      const payload = {
        cwd,
        target: target || {},
        tempWatchIds: (opts && opts.tempWatchIds) || [],
        evidence: (opts && opts.evidence) || [],
        badgeOnly: !!(opts && opts.badgeOnly),
        foreground: !(opts && opts.badgeOnly),
      }
      post('/dsh-vision-bench/focus', payload, 15000).catch((e) => setError(String((e && e.message) || t('fail'))))
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
      // Also push to focus state tempWatchIds
      requestFocusUi(focusState.request || {}, { tempWatchIds: list, badgeOnly: true })
    }

    // ── connection list operations ──
    function addConnection() {
      const pack = normalizePack()
      const nid = hmiGenId('c')
      const did = hmiGenId('d')
      const newConn = { id: nid, name: '连接' + (pack.connections.length + 1), role: 'client', enabled: true, conn: { mode: 'rtu', port: '', baudrate: 9600, bytesize: 8, parity: 'N', stopbits: 1, host: '', tcpPort: 502, slave: 1, sim: false } }
      const newDev = { id: did, connectionId: nid, name: '设备1', unitId: 1, enabled: true }
      const nextConns = (pack.connections || []).concat([newConn])
      const nextDevs = (pack.devices || []).concat([newDev])
      const nextPolling = { ...(pack.pollingByConnection||{}), [nid]: { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' } }
      const nextFrames = { ...(pack.framesByConnection||{}), [nid]: [] }
      persist({ connections: nextConns, devices: nextDevs, pollingByConnection: nextPolling, framesByConnection: nextFrames, activeConnectionId: nid, activeDeviceId: did, version: 3 })
      setHmiTab(nid)
      lastDeviceByConn.current[nid] = did
      setFrameFilter(nid)
    }

    function selectConnection(connId) {
      const pack = normalizePack()
      // restore last device for this connection if any
      let targetDevId = lastDeviceByConn.current[connId]
      if (!targetDevId || !(pack.devices||[]).some((d) => d.id === targetDevId && d.connectionId === connId)) {
        const devFor = (pack.devices||[]).find((d) => d.connectionId === connId)
        targetDevId = devFor ? devFor.id : (pack.devices[0] && pack.devices[0].id) || ''
      }
      persist({ activeConnectionId: connId, activeDeviceId: targetDevId, version: 3 })
      setPendingDeleteId('')
      setHmiTab(connId)
      setMoreOpen(false)
      setFrameFilter(connId)
    }

    function toggleConnEnabled(connId) {
      const pack = normalizePack()
      const nextConns = (pack.connections||[]).map((c) => c.id === connId ? { ...c, enabled: !c.enabled } : c)
      persist({ connections: nextConns, version: 3 })
    }

    function requestDeleteConnection(connId) {
      if (pendingDeleteId !== connId) {
        setPendingDeleteId(connId)
        return
      }
      const pack = normalizePack()
      if ((pack.connections||[]).length <= 1) {
        setError('至少保留一个连接')
        setPendingDeleteId('')
        return
      }
      const nextConns = (pack.connections||[]).filter((c) => c.id !== connId)
      const nextDevs = (pack.devices||[]).filter((d) => d.connectionId !== connId)
      const nextPoints = (pack.points||[]).filter((p) => (p.connectionId || p.connId) !== connId)
      const nextValues = (pack.values||[]).filter((v) => {
        const pid = v.key || v.pointId
        return !nextPoints.some((pt) => pt.id === pid) ? false : true
      })
      // 保留仍存在的 values（更简单：过滤掉被删连接关联的 points 对应的 values）
      const keptValues = (pack.values||[]).filter((v) => {
        const pt = (pack.points||[]).find((p) => p.id === (v.key || v.pointId))
        return pt && (pt.connectionId || pt.connId) !== connId
      })
      const nextPolling = { ...(pack.pollingByConnection||{}) }; delete nextPolling[connId]
      const nextFrames = { ...(pack.framesByConnection||{}) }; delete nextFrames[connId]
      let nextActive = pack.activeConnectionId
      let nextActiveDev = pack.activeDeviceId
      if (nextActive === connId) {
        nextActive = (nextConns[0] && nextConns[0].id) || ''
        const devFor = (nextDevs||[]).find((d) => d.connectionId === nextActive)
        nextActiveDev = devFor ? devFor.id : (nextDevs[0] && nextDevs[0].id) || ''
        setFrameFilter(nextActive || 'all')
        setHmiTab(nextActive || 'all')
      }
      clearFramesLog(cwd, connId)
      setPendingDeleteId('')
      persist({ connections: nextConns, devices: nextDevs, points: nextPoints, values: keptValues, pollingByConnection: nextPolling, framesByConnection: nextFrames, activeConnectionId: nextActive, activeDeviceId: nextActiveDev, version: 3 })
    }

    function openConnEdit(conn) {
      setConnForm({ open: true, id: conn.id, name: conn.name, role: conn.role, enabled: conn.enabled !== false, conn: { ...(conn.conn||{}) } })
    }

    function saveConnEdit() {
      const pack = normalizePack()
      const targetId = connForm.id
      const nextConns = (pack.connections||[]).map((c) => c.id === targetId ? { ...c, name: connForm.name.slice(0,40), role: connForm.role === 'server' || connForm.role === 'slave' ? 'server' : 'client', enabled: !!connForm.enabled, conn: { ...(c.conn||{}), mode: connForm.conn.mode === 'tcp' ? 'tcp' : 'rtu', port: String(connForm.conn.port||'').trim(), baudrate: Number(connForm.conn.baudrate)||9600, bytesize: Number(connForm.conn.bytesize)===7?7:8, parity: ['N','E','O'].includes(connForm.conn.parity)?connForm.conn.parity:'N', stopbits: Number(connForm.conn.stopbits)===2?2:1, host: String(connForm.conn.host||'').trim(), tcpPort: Math.max(1, Math.min(65535, Number(connForm.conn.tcpPort)||502)), slave: Math.max(0, Math.min(247, Number(connForm.conn.slave)||1)), sim: !!connForm.conn.sim } } : c)
      let nextDevs = pack.devices
      const editedConn = nextConns.find((c)=>c.id===targetId)
      if (editedConn && editedConn.conn && editedConn.conn.slave !== undefined) {
        const devFor = (pack.devices||[]).find((d)=>d.connectionId===targetId)
        if (devFor) {
          const unit = Math.max(0, Math.min(247, Number(editedConn.conn.slave)||1))
          nextDevs = (pack.devices||[]).map((d)=> d.id===devFor.id ? { ...d, unitId: unit } : d)
        }
      }
      setConnForm((prev)=> ({ ...prev, open: false }))
      persist({ connections: nextConns, devices: nextDevs, version: 3 })
    }

    function setActiveConnPatch(patch) {
      const pack = normalizePack()
      const aid = pack.activeConnectionId
      if (!aid) return
      const nextConns = (pack.connections||[]).map((c)=> c.id===aid ? { ...c, conn: { ...(c.conn||{}), ...patch } } : c)
      let nextDevs = pack.devices
      if (patch.slave !== undefined) {
        const devId = pack.activeDeviceId
        const unit = Math.max(0, Math.min(247, Math.trunc(Number(patch.slave)||1)))
        if (devId) nextDevs = (pack.devices||[]).map((d)=> d.id===devId ? { ...d, unitId: unit } : d)
      }
      persist({ connections: nextConns, devices: nextDevs, version: 3 })
    }

    function updateActiveConnMeta(patch) {
      const pack = normalizePack()
      const aid = pack.activeConnectionId
      const nextConns = (pack.connections||[]).map((c)=> c.id===aid ? { ...c, ...patch } : c)
      persist({ connections: nextConns, version: 3 })
    }

    // ── point form ──
    function openAddPoint() {
      setError('')
      setBatch((prev) => ({ ...prev, open: false }))
      setWriteRow(null)
      setForm({ mode: 'add', id: '', name: '', function: 3, address: 0, scale: 1, offset: 0, unit: '', alarmMin: '', alarmMax: '' })
    }

    function openEditPoint(point) {
      setError('')
      setWriteRow(null)
      setForm({
        mode: 'edit',
        id: point.id,
        name: point.name,
        function: point.function,
        address: point.address,
        scale: point.scale,
        offset: point.offset,
        unit: point.unit,
        alarmMin: point.alarmMin === null ? '' : String(point.alarmMin),
        alarmMax: point.alarmMax === null ? '' : String(point.alarmMax),
      })
    }

    function closeForm() {
      setForm((prev) => ({ ...prev, mode: 'hidden' }))
    }

    function submitPoint() {
      const pack = normalizePack()
      const activeConnId = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
      const activeDevId = pack.activeDeviceId || ((pack.devices||[]).find((d)=>d.connectionId===activeConnId) && (pack.devices||[]).find((d)=>d.connectionId===activeConnId).id) || (pack.devices[0] && pack.devices[0].id) || 'd1'
      const fnNum = Number(form.function)
      const addrNum = Number(form.address)
      if (!Number.isFinite(addrNum) || addrNum < 0 || addrNum > 65535) {
        setError(t('ptAddr') + ' 0–65535')
        return
      }
      // 去重仅在同一连接内校验，已按 activeConnId 过滤
      const dup = (pack.points||[]).some((p) => (p.connectionId||p.connId) === activeConnId && p.function === fnNum && p.address === addrNum && p.id !== form.id)
      if (dup) {
        setError('已存在相同功能码和地址的点位')
        return
      }
      const base = {
        id: form.mode === 'edit' ? form.id : hmiGenId('p'),
        connectionId: activeConnId,
        connId: activeConnId,
        deviceId: activeDevId,
        name: form.name,
        function: fnNum,
        address: addrNum,
        scale: Number(form.scale) || 1,
        offset: Number(form.offset) || 0,
        unit: form.unit,
        alarmMin: form.alarmMin === '' ? null : Number(form.alarmMin),
        alarmMax: form.alarmMax === '' ? null : Number(form.alarmMax),
        area: fnNum===1?'coil': fnNum===2?'discreteInput': fnNum===4?'inputRegister':'holdingRegister',
      }
      if (form.mode !== 'edit' && (pack.points||[]).some((p)=> p.id===base.id)) {
        base.id = hmiGenId('p')
      }
      let points
      if (form.mode === 'edit') {
        points = (pack.points||[]).map((p) => (p.id === form.id ? { ...p, ...base, id: form.id } : p))
      } else {
        points = (pack.points||[]).concat([base])
      }
      closeForm()
      persist({ points, version: 3 })
    }

    function generateBatch() {
      const pack = normalizePack()
      const activeConnId = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
      const activeDevId = pack.activeDeviceId || ((pack.devices||[]).find((d)=>d.connectionId===activeConnId) && (pack.devices||[]).find((d)=>d.connectionId===activeConnId).id) || (pack.devices[0] && pack.devices[0].id) || 'd1'
      const count = Math.max(1, Math.min(Number(batch.count) || 1, 64))
      const existingIds = new Set((pack.points||[]).filter((p)=> (p.connectionId||p.connId)===activeConnId).map((p)=> p.id))
      const existingAddr = new Set((pack.points||[]).filter((p)=> (p.connectionId||p.connId)===activeConnId && p.function===Number(batch.fc)).map((p)=> p.address))
      const additions = []
      for (let i = 0; i < count; i++) {
        const address = Number(batch.start) + i
        if (existingAddr.has(address)) continue
        const id = hmiGenId('p')
        if (existingIds.has(id)) continue
        additions.push({ id, connectionId: activeConnId, connId: activeConnId, deviceId: activeDevId, name: (batch.prefix || '') + i, function: Number(batch.fc), address, area: Number(batch.fc)===1?'coil':'holdingRegister', scale: 1, offset: 0, unit: '', alarmMin: null, alarmMax: null })
      }
      if (!additions.length) {
        setError('批量点位的地址全部与现有点位重复')
        return
      }
      setError('')
      setBatch((prev) => ({ ...prev, open: false }))
      persist({ points: (pack.points||[]).concat(additions), version: 3 })
    }

    function removePointRow(point) {
      const pack = normalizePack()
      persist({
        points: (pack.points||[]).filter((p) => p.id !== point.id),
        values: (pack.values||[]).filter((v) => (v.key||v.pointId) !== point.id),
        version: 3,
      })
    }

    // ── reads ──
    function readAll() {
      readOne(null)
    }

    function readOne(pointId) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return
      }
      const pack = normalizePack()
      const activeConnId = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
      setBusy(pointId || 'read')
      setError('')
      post('/dsh-vision-bench/modbus/read', {
        cwd,
        source: 'user',
        sessionId,
        all: !pointId,
        pointId: pointId || undefined,
      }, 120000).then((data) => {
        if (!data) return
        // 报文分轨：按 activeConnId 切轨
        pushFramesLog(cwd, activeConnId, data.framesLog || data.frames || [])
        if (Array.isArray(data.values)) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
          workspaceRef.current = { ...workspaceRef.current, modbus: { ...workspaceRef.current.modbus, values: data.values } }
        }
        if (data.ok === false && data.error) setError(data.error)
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.workspace.modbus.values || prev.modbus.values } }))
        }
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      }).finally(() => setBusy(''))
    }

    // ── inline write ──
    function openWriteRow(point) {
      setError('')
      setForm((prev) => ({ ...prev, mode: 'hidden' }))
      const rec = ((normalizePack().values) || []).find((item) => (item.key||item.pointId) === point.id)
      const current = rec && rec.raw !== null && rec.raw !== undefined ? String(rec.raw) : ''
      setWriteRow({ pointId: point.id, name: point.name, fn: point.function, address: point.address, text: current, busy: false, result: null })
    }

    function submitWriteRow() {
      const row = writeRow
      if (!row || !cwd) return
      let values
      if (row.fn === 1) values = [Number(row.text) ? 1 : 0]
      else values = Number.isFinite(Number(row.text)) ? [Number(row.text)] : [NaN]
      const check = normalizeWriteValues(row.fn, values, 1)
      if (!check.ok) {
        setWriteRow((prev) => ({ ...prev, result: { ok: false, error: check.error } }))
        return
      }
      setWriteRow((prev) => ({ ...prev, busy: true, result: null }))
      const pack = normalizePack()
      const activeConnId = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
      post('/dsh-vision-bench/modbus/write', {
        cwd,
        source: 'user',
        sessionId,
        function: row.fn,
        address: row.address,
        values,
      }, 60000).then((data) => {
        setWriteRow((prev) => ({ ...prev, busy: false, result: data }))
        pushFramesLog(cwd, activeConnId, (data && (data.framesLog||data.frames)) || [])
        if (Array.isArray(data.values)) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
          workspaceRef.current = { ...workspaceRef.current, modbus: { ...workspaceRef.current.modbus, values: data.values } }
        }
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.workspace.modbus.values || prev.modbus.values } }))
        }
      }).catch((err) => {
        setWriteRow((prev) => ({ ...prev, busy: false, result: { ok: false, error: String((err && err.message) || t('fail')) } }))
      })
    }

    // ── csv ──
    function exportCsv() {
      const pack = normalizePack()
      // 导出按 activeConnId 过滤的点表
      const activeConnId = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
      const filtered = (pack.points||[]).filter((p)=> (p.connectionId||p.connId)===activeConnId)
      navigator.clipboard.writeText(pointsToCsv(filtered)).then(() => {
        setCsvNote(t('csvDone'))
        setTimeout(() => setCsvNote(''), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function importCsv() {
      const parsed = csvToPoints(csvText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const pack = normalizePack()
      const activeConnId = pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id) || 'c1'
      const activeDevId = pack.activeDeviceId || ((pack.devices||[]).find((d)=>d.connectionId===activeConnId) && (pack.devices||[]).find((d)=>d.connectionId===activeConnId).id) || (pack.devices[0] && pack.devices[0].id) || 'd1'
      // form/batch/csv 均带 connId：为导入点附上 activeConnId/deviceId
      const withConn = parsed.points.map((p)=> ({ ...p, id: p.id || hmiGenId('p'), connectionId: activeConnId, connId: activeConnId, deviceId: activeDevId, area: p.function===1?'coil': p.function===2?'discreteInput': p.function===4?'inputRegister':'holdingRegister' }))
      setError('')
      setCsvOpen(false)
      setCsvText('')
      // 导入替换当前连接下的点表，其余连接保留
      const kept = (pack.points||[]).filter((p)=> (p.connectionId||p.connId)!==activeConnId)
      persist({ points: kept.concat(withConn), values: [], version: 3 })
    }

    // ── derived ──
    const pack = normalizePack()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []
    const activeConnId = pack.activeConnectionId || (connections[0] && connections[0].id) || ''
    const activeDeviceId = pack.activeDeviceId || ((devices||[]).find((d)=>d.connectionId===activeConnId) && (devices||[]).find((d)=>d.connectionId===activeConnId).id) || (devices[0] && devices[0].id) || ''
    const activeConnObj = connections.find((c)=>c.id===activeConnId) || connections[0] || { conn: {} }
    const conn = (activeConnObj && activeConnObj.conn) || {}
    // 点位表按 activeConnId 过滤
    const allPoints = Array.isArray(pack.points) ? pack.points : []
    const points = allPoints.filter((p)=> (p.connectionId||p.connId)===activeConnId)
    // 设备树：选中连接后列出该连接下 devices
    const activeDevices = devices.filter((d)=> d.connectionId===activeConnId)
    const valuesArr = Array.isArray(pack.values) ? pack.values : []
    const valueMap = {}
    for (const item of valuesArr) {
      const k = item.key || item.pointId
      if (k) valueMap[k] = item
    }
    const pythonReady = statusKind(health.python) === 'ready'
    const sim = conn.sim === true
    const canDevice = sim || pythonReady
    const connMissing = !sim && (conn.mode === 'tcp' ? !conn.host : !conn.port)
    const pollingByConnection = pack.pollingByConnection || {}
    const polling = pollingByConnection[activeConnId] || { enabled: false, intervalMs: 1000 }
    const watchEnabled = !!polling.enabled

    function toggleSim() {
      const next = !sim
      // persist 按 connId 定向，toggleSim 按 activeConnId
      setActiveConnPatch({ sim: next })
      if (next && typeof openLive === 'function') openLive()
    }

    function toggleWatch() {
      const nextPolling = { ...(pollingByConnection||{}), [activeConnId]: { ...polling, enabled: !watchEnabled, intervalMs: polling.intervalMs || 1000 } }
      persist({ pollingByConnection: nextPolling, version: 3 })
      if (!watchEnabled && typeof openLive === 'function') openLive()
    }

    function setPollingInterval(ms) {
      const nextPolling = { ...(pollingByConnection||{}), [activeConnId]: { ...polling, enabled: true, intervalMs: Number(ms)||1000 } }
      persist({ pollingByConnection: nextPolling, version: 3 })
    }

    // ── COM 去重：rtu port 全局置灰、tcp host:port 同理，sim 仍占位 ──
    function findRtuOccupier(port, excludeId) {
      if (!port) return null
      const key = String(port).trim().toLowerCase()
      const hit = connections.find((c)=> c.id!==excludeId && c.enabled!==false && c.conn && c.conn.mode==='rtu' && String(c.conn.port||'').trim().toLowerCase()===key)
      return hit ? hit.name : null
    }
    function findTcpOccupier(host, tcpPort, excludeId) {
      const key = String(host||'').trim().toLowerCase() + ':' + String(tcpPort||502)
      const hit = connections.find((c)=> {
        if (c.id===excludeId || c.enabled===false) return false
        const cc = c.conn||{}
        if (cc.mode!=='tcp') return false
        const k = String(cc.host||'').trim().toLowerCase() + ':' + String(cc.tcpPort||502)
        return k===key
      })
      return hit ? hit.name : null
    }

    // ── serial log / frames 分轨 ──
    function openSerial() {
      if (!cwd) return
      post('/dsh-vision-bench/serial/open', {
        cwd,
        port: serial.port,
        baudrate: Number(serial.baudrate) || 115200,
      }, 15000).then((data) => {
        if (!data || data.ok === false) {
          setSerial((prev) => ({ ...prev, error: (data && data.error) || t('fail') }))
          return
        }
        setSerial((prev) => ({ ...prev, open: true, error: '', lines: [], lastId: 0 }))
      }).catch((err) => {
        setSerial((prev) => ({ ...prev, error: String((err && err.message) || t('fail')) }))
      })
    }

    function closeSerial() {
      if (!cwd) return
      post('/dsh-vision-bench/serial/close', { cwd }, 10000).catch(() => { /* ignore */ })
      setSerial((prev) => ({ ...prev, open: false, lines: [], lastId: 0, error: '' }))
    }

    const serialFilterText = serial.filter.trim().toLowerCase()
    const serialLines = serialFilterText
      ? serial.lines.filter((item) => item.line.toLowerCase().includes(serialFilterText))
      : serial.lines
    // 报文分轨：framesByConnection 按 activeConnId 切轨，顶部 全部|COM3|COM4 切轨
    // getFramesLog 支持按 connId，'all' 聚合
    const framesAll = frameFilter === 'all' ? getFramesLog(cwd) : getFramesLog(cwd, frameFilter)
    // 若当前 filter 为 all 但 activeConnId 存在时，仍可按 activeConnId 高亮？保持按 filter 展示
    const frameRows = framesAll.map((item) => ({
      t: item.t,
      tx: '→ ' + (item.request || '(无帧)') + ' · ' + item.label + (item.deviceName ? ' · ' + item.deviceName : ''),
      rx: item.response ? '← ' + item.response : '',
      connectionId: item.connectionId || '',
    }))
    const frameRowsFiltered = serialFilterText
      ? frameRows.filter((item) => (item.tx + item.rx).toLowerCase().includes(serialFilterText))
      : frameRows

    function copyLogText() {
      if (logMode === 'frames') {
        const rows = frameRowsFiltered
        const text = rows.map((item) => '[' + clockOf(item.t) + '] ' + item.tx + (item.rx ? '\n  ' + item.rx : '')).join('\n')
        if (!text) return
        navigator.clipboard.writeText(text).then(() => {
          setCopiedSerial(true)
          setTimeout(() => setCopiedSerial(false), 1500)
        }).catch(() => { /* clipboard unavailable */ })
        return
      }
      const filterText = serial.filter.trim().toLowerCase()
      const visible = filterText
        ? serial.lines.filter((item) => item.line.toLowerCase().includes(filterText))
        : serial.lines
      const text = visible.map((item) => '[' + clockOf(item.t) + '] ' + item.line).join('\n')
      if (!text) return
      navigator.clipboard.writeText(text).then(() => {
        setCopiedSerial(true)
        setTimeout(() => setCopiedSerial(false), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function logBody() {
      if (logMode === 'frames') {
        if (!frameRowsFiltered.length) return el('div', { className: 'dvb-empty' }, t('framesEmpty'))
        return el('div', {
          className: 'dvb-log dvb-serial-log',
          style: { maxHeight: '260px', overflowY: 'auto' },
          ref: (node) => {
            if (node && !serial.paused) node.scrollTop = node.scrollHeight
          },
        }, frameRowsFiltered.map((item, idx) => {
          const fid = item.id || item.frameId || (String(item.connectionId || 'c') + ':' + String(item.t) + ':' + idx)
          const isFocused = focusState && focusState.request && focusState.request.frameId === fid
          return el('div', {
            key: fid + ':' + idx,
            className: 'dvb-serial-line' + focusHighlightClass(isFocused),
            'data-focused': isFocused ? 'true' : 'false',
            style: isFocused ? { background: 'rgba(79,142,247,.12)', borderRadius: '4px', padding: '2px 4px' } : null,
          },
            '[' + clockOf(item.t) + '] ' + item.tx,
            item.rx ? el('div', null, '  ' + item.rx) : null,
            el('span', { style: { display: 'inline-flex', gap: '4px', marginLeft: '8px' } },
              el('button', {
                type: 'button', className: 'dvb-btn dvb-btn-sm',
                title: '复制报文结构化引用（稳定 ID+配置版本+时间范围）',
                onClick() { sendToAgent('frame', { frameId: fid, connectionId: item.connectionId, deviceId: item.deviceId, label: item.label }) },
              }, agentCopied === 'frame:' + fid ? '已复制' : '让 Agent 分析'),
              el('button', {
                type: 'button', className: 'dvb-btn dvb-btn-sm' + (isFocused ? ' is-on' : ''),
                title: '聚焦此报文，高亮并支持证据跳转',
                onClick() { requestFocusUi({ connectionId: item.connectionId, deviceId: item.deviceId, frameId: fid, kind: 'frame' }) },
              }, '聚焦')))
        }))
      }
      if (!serialLines.length) return el('div', { className: 'dvb-empty' }, t('serialEmpty'))
      return el('pre', {
        className: 'dvb-log dvb-serial-log',
        ref: (node) => {
          if (node && !serial.paused) node.scrollTop = node.scrollHeight
        },
      }, serialLines.map((item) => el('div', {
        key: item.id,
        className: 'dvb-serial-line',
        'data-kind': lineKind(item.line),
      }, '[' + clockOf(item.t) + '] ' + item.line)))
    }

    const serialPanel = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, logMode === 'frames' ? t('framesTitle') : t('serialTitle')),
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (logMode === 'serial' ? ' is-on' : ''),
          onClick() { setLogMode('serial') },
        }, t('logTabSerial')),
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (logMode === 'frames' ? ' is-on' : ''),
          onClick() { setLogMode('frames') },
        }, t('logTabFrames')),
        logMode === 'frames'
          ? el('span', { style: { display: 'flex', gap: '4px', alignItems: 'center', marginLeft: '8px' } },
              el('button', {
                type: 'button',
                className: 'dvb-btn' + (frameFilter === 'all' ? ' is-on' : ''),
                onClick() { setFrameFilter('all') },
              }, '全部'),
              connections.map((c)=> {
                const label = c.conn && c.conn.mode==='tcp' ? ((c.conn.host||'TCP') + ':' + (c.conn.tcpPort||502)) : (c.conn && c.conn.port ? c.conn.port : c.name)
                return el('button', {
                  key: c.id,
                  type: 'button',
                  className: 'dvb-btn' + (frameFilter===c.id ? ' is-on' : ''),
                  title: c.name + ' · ' + connLabel(c.conn||{}),
                  onClick() { setFrameFilter(c.id) },
                }, label)
              }),
              el('button', {
                type: 'button', className: 'dvb-btn',
                onClick() { clearFramesLog(cwd, frameFilter) },
              }, t('framesClear')))
          : null,
        el('div', { style: { flex: 1 } }),
        logMode === 'serial'
          ? el('span', { className: 'dvb-live-dot', 'data-kind': serial.open ? (serial.error ? 'err' : 'live') : 'idle' })
          : null,
        logMode === 'serial' && serial.open && serial.port ? el('span', { className: 'dvb-map-meta' }, serial.port + ' @ ' + serial.baudrate) : null,
        logMode === 'serial' && serial.error ? el('span', { className: 'dvb-need' }, serial.error) : null,
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: logMode === 'serial'
            ? (!serial.open || !serialLines.length)
            : (!frameRows.length),
          onClick: copyLogText,
        }, copiedSerial ? t('serialCopied') : t('serialCopy')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: logMode === 'serial' && !serial.open,
          onClick() { setSerial((prev) => ({ ...prev, paused: !prev.paused })) },
        }, serial.paused ? t('serialResume') : t('serialPause'))),
      field(t('serialFilter'), el('input', {
        className: 'dvb-input',
        value: serial.filter,
        placeholder: 'error, assert…',
        spellCheck: false,
        autoComplete: 'off',
        onChange: (event)=>{ setSerial((prev) => ({ ...prev, filter: event.target.value })) },
      })),
      logBody())

    // ── Agent 聚焦横幅（角标不抢焦点，支持返回原焦点 + 临时监视组）──
    const focusBanner = focusState && focusState.request
      ? el('div', { className: 'dvb-panel dvb-focus-banner', 'data-badge': focusState.badgeOnly ? 'true' : 'false' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, 'Agent 聚焦' + (focusState.badgeOnly ? ' · 角标' : ' · 高亮')),
            el('span', { className: 'dvb-tag' }, [focusState.request.connectionId, focusState.request.deviceId, focusState.request.pointId || focusState.request.frameId].filter(Boolean).join(' / ') || '未知目标'),
            focusState.request && focusState.request.at ? el('span', { className: 'dvb-map-meta' }, clockOf(focusState.request.at)) : null,
            el('button', { type: 'button', className: 'dvb-btn', onClick: returnToPrevFocus, disabled: !focusState.prev }, '返回原焦点'),
            el('button', { type: 'button', className: 'dvb-btn', onClick() { requestFocusUi(null, { badgeOnly: false }); setFocusUi({ request: null, prev: focusState.request, tempWatchIds: [], badgeOnly: false, evidence: [] }) } }, '清除聚焦'),
            focusState.tempWatchIds && focusState.tempWatchIds.length ? el('span', { className: 'dvb-tag' }, '临时监视 ' + focusState.tempWatchIds.length) : null,
            focusState.badgeOnly ? el('span', { className: 'dvb-chip', 'data-kind': 'warn' }, '后台任务 · 仅角标') : null),
          el('div', { className: 'dvb-toolbar' },
            el('button', {
              type: 'button', className: 'dvb-btn dvb-btn-primary',
              onClick() {
                const r = focusState.request
                if (r && r.connectionId) { selectConnection(r.connectionId); if (r.deviceId) persist({ activeDeviceId: r.deviceId, version: 3 }) }
                if (r && r.pointId) setFrameFilter(r.connectionId || frameFilter)
              },
            }, '跳转到目标'),
            focusState.request && focusState.request.pointId ? el('button', {
              type: 'button', className: 'dvb-btn',
              onClick() { sendToAgent('point', { pointId: focusState.request.pointId, connectionId: focusState.request.connectionId, deviceId: focusState.request.deviceId }) },
            }, agentCopied.startsWith('point:') ? '已复制' : '让 Agent 分析') : null,
            focusState.request && focusState.request.frameId ? el('button', {
              type: 'button', className: 'dvb-btn',
              onClick() { sendToAgent('frame', { frameId: focusState.request.frameId, connectionId: focusState.request.connectionId }) },
            }, '让 Agent 分析报文') : null,
            tempWatchNote ? el('span', { className: 'dvb-hint' }, tempWatchNote) : null,
            agentCopied ? el('span', { className: 'dvb-hint' }, '已复制引用 · 粘贴给 Agent') : null))
      : null

    // ── 顶部连接列表 ──
    const connListPanel = el('div', { className: 'dvb-panel' + (focusState && focusState.request && focusState.request.connectionId ? ' dvb-has-focus' : '') },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('connBar') || '连接'),
        el('span', { className: 'dvb-tag' }, connections.length + ' 个连接'),
        el('button', {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd,
          onClick: addConnection,
        }, '＋连接'),
        activeConnObj ? el('span', { className: 'dvb-tag' }, connLabel(activeConnObj.conn||{})) : null,
        sim ? el('span', { className: 'dvb-tag' }, t('sim')) : null,
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (sim ? ' is-on' : ''),
          disabled: !cwd || !activeConnId,
          title: t('simHint'),
          onClick: toggleSim,
        }, t('sim')),
        !canDevice ? el('span', { className: 'dvb-need' }, t('needBindingsRead')) : null),
      connections.length
        ? el('div', { className: 'dvb-table-wrap' },
            el('table', { className: 'dvb-table' },
              el('thead', null, el('tr', null,
                el('th', null, '名称'),
                el('th', null, t('role') || '角色'),
                el('th', null, '启用'),
                el('th', null, t('connBar')),
                el('th', null, '操作'))),
              el('tbody', null, connections.map((c)=> {
                const isActive = c.id === activeConnId
                const roleLabel = (c.role === 'server' || c.role === 'slave') ? (t('roleSlave')||'从机') : (t('roleMaster')||'主机')
                const enabled = c.enabled !== false
                const occupiedPort = c.conn && c.conn.mode==='rtu' && c.conn.port ? findRtuOccupier(c.conn.port, c.id) : null
                return el('tr', { key: c.id, 'data-active': isActive ? 'true' : 'false', style: isActive ? { background: 'var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1))' } : null },
                  el('td', null,
                    el('button', {
                      type: 'button',
                      className: 'dvb-btn' + (isActive ? ' is-on dvb-btn-primary' : ''),
                      title: isActive ? '当前连接' : '切换到此连接',
                      onClick() { selectConnection(c.id) },
                    }, c.name + (isActive ? ' ●' : ''))),
                  el('td', null,
                    el('select', {
                      className: 'dvb-input',
                      value: c.role === 'server' || c.role === 'slave' ? 'server' : 'client',
                      disabled: !cwd,
                      onChange: (event)=>{
                        const nextRole = event.target.value
                        const nextConns = connections.map((x)=> x.id===c.id ? { ...x, role: nextRole } : x)
                        persist({ connections: nextConns, version: 3 })
                      },
                    },
                      el('option', { value: 'client' }, t('roleMaster')||'主机(master)'),
                      el('option', { value: 'server' }, t('roleSlave')||'从机(slave)'))),
                  el('td', null,
                    el('label', { style: { display: 'flex', alignItems: 'center', gap: '4px' } },
                      el('input', {
                        type: 'checkbox',
                        checked: enabled,
                        disabled: !cwd,
                        onChange() { toggleConnEnabled(c.id) },
                      }),
                      enabled ? '启用' : '禁用')),
                  el('td', { title: occupiedPort ? '已被 ' + occupiedPort + ' 占用' : '' }, connLabel(c.conn||{}) + (occupiedPort ? ' · 已被 ' + occupiedPort + ' 占用' : '')),
                  el('td', null,
                    el('div', { className: 'dvb-actions' },
                      el('button', {
                        type: 'button', className: 'dvb-btn',
                        onClick() { openConnEdit(c) },
                      }, '编辑'),
                      el('button', {
                        type: 'button', className: 'dvb-btn dvb-btn-sm',
                        title: '复制结构化引用（稳定 ID+配置版本）并让 Agent 分析',
                        onClick() { sendToAgent('connection', { connectionId: c.id, name: c.name }) },
                      }, agentCopied === 'connection:' + c.id ? '已复制' : '让 Agent 分析'),
                      el('button', {
                        type: 'button', className: 'dvb-btn dvb-btn-sm' + (focusState.request && focusState.request.connectionId === c.id && !focusState.request.pointId ? ' is-on' : ''),
                        title: '聚焦此连接标签，高亮并支持返回原焦点',
                        onClick() { requestFocusUi({ connectionId: c.id, kind: 'connection' }) },
                      }, '聚焦'),
                      pendingDeleteId === c.id
                        ? el('span', { style: { display: 'flex', gap: '4px', alignItems: 'center' } },
                            el('span', { className: 'dvb-need' }, '确认删除？'),
                            el('button', {
                              type: 'button', className: 'dvb-btn dvb-btn-primary',
                              onClick() { requestDeleteConnection(c.id) },
                            }, '确认'),
                            el('button', {
                              type: 'button', className: 'dvb-btn',
                              onClick() { setPendingDeleteId('') },
                            }, '取消'))
                        : el('button', {
                            type: 'button', className: 'dvb-btn',
                            disabled: connections.length<=1,
                            title: connections.length<=1 ? '至少保留一个连接' : '',
                            onClick() { requestDeleteConnection(c.id) },
                          }, t('removeDevice')))))
              }))))
        : el('div', { className: 'dvb-empty' }, '暂无连接，点击「＋连接」创建'))

    const connFormPanel = connForm.open
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, '编辑连接 · ' + connForm.id),
            el('button', { type: 'button', className: 'dvb-btn', onClick(){ setConnForm((prev)=>({...prev, open:false})) } }, t('csvCancel'))),
          el('div', { className: 'dvb-toolbar' },
            field('名称', el('input', {
              className: 'dvb-input',
              value: connForm.name,
              onChange: (event)=>{ setConnForm((prev)=> ({ ...prev, name: event.target.value })) },
            })),
            field(t('role')||'角色', el('select', {
              className: 'dvb-input',
              value: connForm.role === 'server' || connForm.role==='slave' ? 'server' : 'client',
              onChange: (event)=>{ setConnForm((prev)=> ({ ...prev, role: event.target.value })) },
            },
              el('option', { value: 'client' }, '主机(master)'),
              el('option', { value: 'server' }, '从机(slave)'))),
            field('启用', el('label', { style:{display:'flex',gap:'4px',alignItems:'center'} },
              el('input', { type:'checkbox', checked: !!connForm.enabled, onChange: (event)=>{ setConnForm((prev)=>({...prev, enabled: event.target.checked})) } }),
              connForm.enabled ? '启用' : '禁用')),
            field(t('mode'), el('select', {
              className: 'dvb-input',
              value: connForm.conn.mode || 'rtu',
              onChange: (event)=>{ setConnForm((prev)=> ({ ...prev, conn: { ...prev.conn, mode: event.target.value } })) },
            },
              el('option', { value: 'rtu' }, 'RTU'),
              el('option', { value: 'tcp' }, 'TCP'))),
            connForm.conn.mode === 'rtu'
              ? field(t('serial'), el('div', { className: 'dvb-combo' },
                  el('select', {
                    className: 'dvb-input dvb-input-mono',
                    value: connForm.conn.port || '',
                    disabled: scanning,
                    onChange: (event)=>{ setConnForm((prev)=> ({ ...prev, conn: { ...prev.conn, port: event.target.value } })) },
                  },
                    el('option', { value: '' }, scanning ? t('serialScanning') : (ports.length ? t('serialPick') : t('serialNone'))),
                    connForm.conn.port && !ports.some((item)=> item.path===connForm.conn.port)
                      ? el('option', { value: connForm.conn.port }, connForm.conn.port + ' · ' + t('serialGone'))
                      : null,
                    ports.map((item)=>{
                      const occupier = findRtuOccupier(item.path, connForm.id)
                      return el('option', { key: item.path, value: item.path, disabled: !!occupier, title: occupier ? '已被 ' + occupier + ' 占用' : '' }, (item.label||item.path) + (occupier ? ' · 已被 ' + occupier + ' 占用' : ''))
                    })),
                  el('button', { type:'button', className:'dvb-btn', disabled: scanning, title: t('serialScan'), onClick: scanPorts }, t('serialScan'))))
              : field(t('host'), el('div', { className: 'dvb-combo' },
                  el('input', {
                    className: 'dvb-input dvb-input-mono',
                    value: connForm.conn.host || '',
                    placeholder: t('hostPh')||'192.168.1.10',
                    spellCheck: false,
                    autoComplete: 'off',
                    onChange: (event)=>{
                      const host = event.target.value
                      setConnForm((prev)=> ({ ...prev, conn: { ...prev.conn, host } }))
                    },
                  }),
                  el('input', {
                    className: 'dvb-input dvb-input-mono',
                    value: connForm.conn.tcpPort || 502,
                    type: 'number',
                    style: { width: '80px', flex: 'none' },
                    onChange: (event)=>{ setConnForm((prev)=> ({ ...prev, conn: { ...prev.conn, tcpPort: Number(event.target.value) } })) },
                  }),
                  (()=>{ const occupier = findTcpOccupier(connForm.conn.host, connForm.conn.tcpPort, connForm.id); return occupier ? el('span', { className:'dvb-need', title:'已被 ' + occupier + ' 占用' }, '已被 ' + occupier + ' 占用') : null })()
                  )),
            field(t('baudrate'), el('input', { className:'dvb-input dvb-input-mono', type:'number', value: connForm.conn.baudrate||9600, onChange: (event)=>{ setConnForm((prev)=>({...prev, conn:{...prev.conn, baudrate: Number(event.target.value)}})) } })),
            field(t('slave')||'站号/单元', el('input', { className:'dvb-input dvb-input-mono', type:'number', value: connForm.conn.slave, min:0, max:247, onChange: (event)=>{ setConnForm((prev)=>({...prev, conn:{...prev.conn, slave: Number(event.target.value)}})) } })),
            field(t('databits'), el('select', { className:'dvb-input', value: String(connForm.conn.bytesize||8), onChange: (event)=>{ setConnForm((prev)=>({...prev, conn:{...prev.conn, bytesize: Number(event.target.value)}})) } }, el('option',{value:'8'},'8'), el('option',{value:'7'},'7'))),
            field(t('parityBit'), el('select', { className:'dvb-input', value: connForm.conn.parity||'N', onChange: (event)=>{ setConnForm((prev)=>({...prev, conn:{...prev.conn, parity: event.target.value}})) } }, el('option',{value:'N'},'N'), el('option',{value:'E'},'E'), el('option',{value:'O'},'O'))),
            field(t('stopbit'), el('select', { className:'dvb-input', value: String(connForm.conn.stopbits||1), onChange: (event)=>{ setConnForm((prev)=>({...prev, conn:{...prev.conn, stopbits: Number(event.target.value)}})) } }, el('option',{value:'1'},'1'), el('option',{value:'2'},'2'))),
            field(t('sim'), el('label', { style:{display:'flex',gap:'4px',alignItems:'center'} },
              el('input', { type:'checkbox', checked: !!connForm.conn.sim, onChange: (event)=>{ setConnForm((prev)=>({...prev, conn:{...prev.conn, sim: event.target.checked}})) } }),
              t('simHint')||'仿真'))),
          el('div', { className:'dvb-actions' },
            el('button', { type:'button', className:'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: saveConnEdit }, t('savePoint')||'保存'),
            el('button', { type:'button', className:'dvb-btn', onClick(){ setConnForm((prev)=>({...prev, open:false})) } }, t('csvCancel'))))
      : null

    // ── 设备树 ──
    const devicePanel = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, '设备 · ' + (activeConnObj ? activeConnObj.name : '')),
        el('span', { className: 'dvb-tag' }, activeDevices.length + ' 设备'),
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: !cwd || !activeConnId,
          onClick(){
            const pack = normalizePack()
            const nid = hmiGenId('d')
            const newDev = { id: nid, connectionId: activeConnId, name: '设备' + (activeDevices.length+1), unitId: 1, enabled: true }
            persist({ devices: (pack.devices||[]).concat([newDev]), activeDeviceId: nid, version:3 })
            lastDeviceByConn.current[activeConnId] = nid
          },
        }, '＋设备')),
      activeDevices.length
        ? el('div', { className: 'dvb-table-wrap' },
            el('table', { className:'dvb-table' },
              el('thead', null, el('tr', null, el('th', null, '名称'), el('th', null, '站号'), el('th', null, '启用'), el('th', null, '点位数'), el('th', null, ''))),
              el('tbody', null, activeDevices.map((d)=>{
                const isActiveDev = d.id===activeDeviceId
                const ptCount = (allPoints||[]).filter((p)=> (p.deviceId||'d1')===d.id && (p.connectionId||p.connId)===activeConnId).length
                return el('tr', { key: d.id, 'data-active': isActiveDev?'true':'false', style: isActiveDev?{background:'var(--dsw-alias-bg-layer-2,rgba(128,128,128,.1))'}:null },
                  el('td', null,
                    el('button', {
                      type:'button',
                      className:'dvb-btn' + (isActiveDev ? ' is-on dvb-btn-primary' : ''),
                      onClick(){ persist({ activeDeviceId: d.id, version:3 }); lastDeviceByConn.current[activeConnId] = d.id },
                    }, d.name + (isActiveDev ? ' ●' : ''))),
                  el('td', null, String(d.unitId)),
                  el('td', null, d.enabled!==false ? '启用' : '禁用'),
                  el('td', null, String(ptCount)),
                  el('td', null,
                    el('div', { className:'dvb-actions' },
                      el('button', {
                        type:'button', className:'dvb-btn',
                        onClick(){
                          const name = typeof prompt==='function' ? prompt('设备名称', d.name) : null
                          if (name===null) return
                          const nextDevs = devices.map((x)=> x.id===d.id ? { ...x, name: String(name).slice(0,40)||x.name } : x)
                          persist({ devices: nextDevs, version:3 })
                        },
                      }, '重命名'),
                      el('button', {
                        type:'button', className:'dvb-btn dvb-btn-sm',
                        title: '复制设备结构化引用并让 Agent 分析',
                        onClick(){ sendToAgent('device', { deviceId: d.id, connectionId: d.connectionId, name: d.name }) },
                      }, agentCopied === 'device:' + d.id ? '已复制' : '让 Agent 分析'),
                      el('button', {
                        type:'button', className:'dvb-btn dvb-btn-sm' + (focusState.request && focusState.request.deviceId === d.id ? ' is-on' : ''),
                        title: '聚焦此设备',
                        onClick(){ requestFocusUi({ connectionId: d.connectionId, deviceId: d.id, kind: 'device' }) },
                      }, '聚焦'),
                      el('button', {
                        type:'button', className:'dvb-btn',
                        disabled: activeDevices.length<=1,
                        onClick(){
                          const nextDevs = devices.filter((x)=> x.id!==d.id)
                          const nextPoints = allPoints.filter((p)=> p.deviceId!==d.id)
                          persist({ devices: nextDevs, points: nextPoints, version:3 })
                        },
                      }, '删除'))) )
              }))))
        : el('div', { className:'dvb-empty' }, '该连接暂无设备'))


    // ── 当前连接详情（旧 connBar 兼容，展示 active 连接可编辑字段，COM 去重）──
    const activeConnDetail = activeConnId
      ? el('div', { className: 'dvb-panel' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, '当前连接 · ' + (activeConnObj.name||activeConnId)),
            el('span', { className: 'dvb-tag' }, connLabel(conn)),
            sim ? el('span', { className: 'dvb-tag' }, t('sim')) : null,
            !canDevice ? el('span', { className: 'dvb-need' }, t('needBindingsRead')) : null),
          el('div', { className: 'dvb-toolbar' },
            field(t('mode'), el('select', {
              className: 'dvb-input',
              value: conn.mode || 'rtu',
              onChange: (event)=>{ setActiveConnPatch({ mode: event.target.value }) },
            },
              el('option', { value: 'rtu' }, 'RTU'),
              el('option', { value: 'tcp' }, 'TCP'))),
            conn.mode === 'rtu'
              ? field(t('serial'), el('div', { className: 'dvb-combo' },
                  el('select', {
                    className: 'dvb-input dvb-input-mono',
                    value: conn.port || '',
                    disabled: scanning,
                    onChange: (event)=>{ setActiveConnPatch({ port: event.target.value }) },
                  },
                    el('option', { value: '' }, scanning ? t('serialScanning') : (ports.length ? t('serialPick') : t('serialNone'))),
                    conn.port && !ports.some((item)=> item.path===conn.port)
                      ? el('option', { value: conn.port }, conn.port + ' · ' + t('serialGone'))
                      : null,
                    ports.map((item)=>{
                      const occupier = findRtuOccupier(item.path, activeConnId)
                      return el('option', { key: item.path, value: item.path, disabled: !!occupier, title: occupier ? '已被 ' + occupier + ' 占用' : '' }, (item.label||item.path) + (occupier ? ' · 已被 ' + occupier + ' 占用' : ''))
                    })),
                  el('button', { type:'button', className:'dvb-btn', disabled: scanning, title: t('serialScan'), onClick: scanPorts }, t('serialScan'))))
              : field(t('host'), el('div', { className:'dvb-combo' },
                  el('input', {
                    className:'dvb-input dvb-input-mono',
                    value: conn.host||'',
                    placeholder: t('hostPh')||'192.168.1.10',
                    spellCheck:false,
                    autoComplete:'off',
                    onChange: (event)=>{
                      const host = event.target.value
                      const occupier = findTcpOccupier(host, conn.tcpPort, activeConnId)
                      if (occupier) setError('已被 ' + occupier + ' 占用: ' + host + ':' + (conn.tcpPort||502))
                      else setError('')
                      setActiveConnPatch({ host })
                    },
                  }),
                  el('input', {
                    className:'dvb-input dvb-input-mono',
                    value: conn.tcpPort||502,
                    type:'number',
                    style:{width:'90px', flex:'none'},
                    onChange: (event)=>{ setActiveConnPatch({ tcpPort: Number(event.target.value) }) },
                  }),
                  (()=>{ const occupier = findTcpOccupier(conn.host, conn.tcpPort, activeConnId); return occupier ? el('span', {className:'dvb-need', title:'已被 ' + occupier + ' 占用'}, '已被 ' + occupier + ' 占用') : null })()
                  )),
            field(t('baudrate'), el('input', { className:'dvb-input dvb-input-mono', type:'number', value: conn.baudrate||9600, onChange: (event)=>{ setActiveConnPatch({ baudrate: Number(event.target.value) }) } })),
            field(t('slave')||'站号', el('input', { className:'dvb-input dvb-input-mono', type:'number', value: (activeDevices.find((d)=>d.id===activeDeviceId) && activeDevices.find((d)=>d.id===activeDeviceId).unitId) || conn.slave || 1, min:0, max:247, onChange: (event)=>{ setActiveConnPatch({ slave: Number(event.target.value) }) } })),
            field(t('databits'), el('select', { className:'dvb-input', value: String(conn.bytesize||8), onChange: (event)=>{ setActiveConnPatch({ bytesize: Number(event.target.value) }) } }, el('option',{value:'8'},'8'), el('option',{value:'7'},'7'))),
            field(t('parityBit'), el('select', { className:'dvb-input', value: conn.parity||'N', onChange: (event)=>{ setActiveConnPatch({ parity: event.target.value }) } }, el('option',{value:'N'},'N'), el('option',{value:'E'},'E'), el('option',{value:'O'},'O'))),
            field(t('stopbit'), el('select', { className:'dvb-input', value: String(conn.stopbits||1), onChange: (event)=>{ setActiveConnPatch({ stopbits: Number(event.target.value) }) } }, el('option',{value:'1'},'1'), el('option',{value:'2'},'2'))),
            field('角色', el('select', {
              className:'dvb-input',
              value: activeConnObj.role === 'server' || activeConnObj.role==='slave' ? 'server' : 'client',
              onChange: (event)=>{ updateActiveConnMeta({ role: event.target.value }) },
            }, el('option',{value:'client'}, '主机(master)'), el('option',{value:'server'}, '从机(slave)'))),
            field('启用', el('label', { style:{display:'flex',gap:'4px',alignItems:'center'} },
              el('input', { type:'checkbox', checked: activeConnObj.enabled!==false, onChange(){ toggleConnEnabled(activeConnId) } }),
              activeConnObj.enabled!==false ? '启用' : '禁用'))))
      : null

    // ── point form ──
    const formPanel = form.mode !== 'hidden'
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-panel-head' },
          el('span', { className: 'dvb-panel-title' }, (form.mode === 'edit' ? t('editing') : t('addPoint'))
            + (form.mode === 'edit' ? ' · ' + form.id : '') + ' · ' + (activeConnObj ? activeConnObj.name : '')),
          el('button', {
            type: 'button', className: 'dvb-btn', onClick: closeForm,
          }, t('csvCancel'))),
        el('div', { className: 'dvb-toolbar' },
          field(t('ptName'), el('input', {
            className: 'dvb-input',
            value: form.name,
            placeholder: t('ptNamePh'),
            onChange: (event)=>{ setForm((prev) => ({ ...prev, name: event.target.value })) },
          })),
          field(t('ptFc'), el('select', {
            className: 'dvb-input',
            value: String(form.function),
            onChange: (event)=>{ setForm((prev) => ({ ...prev, function: Number(event.target.value) })) },
          },
            el('option', { value: '1' }, fnOptionLabel(t, 1)),
            el('option', { value: '2' }, fnOptionLabel(t, 2)),
            el('option', { value: '3' }, fnOptionLabel(t, 3)),
            el('option', { value: '4' }, fnOptionLabel(t, 4)))),
          field(t('ptAddr'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number',
            value: form.address,
            min: 0, max: 65535,
            onChange: (event)=>{ setForm((prev) => ({ ...prev, address: Number(event.target.value) })) },
          })),
          field('所属设备', el('select', {
            className: 'dvb-input',
            value: (form.deviceId || activeDeviceId || (activeDevices[0] && activeDevices[0].id) || ''),
            onChange: (event)=>{ setForm((prev)=> ({ ...prev, deviceId: event.target.value })) },
          }, activeDevices.map((d)=> el('option', { key:d.id, value:d.id }, d.name + ' · 站号 ' + d.unitId)))),
          field(t('ptScale'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.scale,
            onChange: (event)=>{ setForm((prev) => ({ ...prev, scale: Number(event.target.value) })) },
          })),
          field(t('ptOffset'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.offset,
            onChange: (event)=>{ setForm((prev) => ({ ...prev, offset: Number(event.target.value) })) },
          })),
          field(t('ptUnit'), el('input', {
            className: 'dvb-input',
            value: form.unit,
            onChange: (event)=>{ setForm((prev) => ({ ...prev, unit: event.target.value })) },
          })),
          field(t('ptAlarmMin'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.alarmMin,
            onChange: (event)=>{ setForm((prev) => ({ ...prev, alarmMin: event.target.value })) },
          })),
          field(t('ptAlarmMax'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.alarmMax,
            onChange: (event)=>{ setForm((prev) => ({ ...prev, alarmMax: event.target.value })) },
          }))),
        el('div', { className: 'dvb-actions' },
          el('button', {
            type: 'button', className: 'dvb-btn dvb-btn-primary',
            disabled: !cwd,
            onClick: submitPoint,
          }, t('savePoint'))))
      : null

    const batchPanel = batch.open
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-hint' }, t('batchAdd') + ' · ' + (activeConnObj ? activeConnObj.name : '')),
        el('div', { className: 'dvb-toolbar' },
          field(t('batchPrefix'), el('input', {
            className: 'dvb-input',
            value: batch.prefix,
            placeholder: 'HR',
            onChange: (event)=>{ setBatch((prev) => ({ ...prev, prefix: event.target.value })) },
          })),
          field(t('ptFc'), el('select', {
            className: 'dvb-input',
            value: String(batch.fc),
            onChange: (event)=>{ setBatch((prev) => ({ ...prev, fc: Number(event.target.value) })) },
          },
            el('option', { value: '1' }, fnOptionLabel(t, 1)),
            el('option', { value: '3' }, fnOptionLabel(t, 3)))),
          field(t('batchStart'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number',
            value: batch.start,
            min: 0, max: 65535,
            onChange: (event)=>{ setBatch((prev) => ({ ...prev, start: Number(event.target.value) })) },
          })),
          field(t('batchCount'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number',
            value: batch.count, min: 1, max: 64,
            onChange: (event)=>{ setBatch((prev) => ({ ...prev, count: Number(event.target.value) })) },
          })),
          field('设备', el('select', {
            className:'dvb-input',
            value: batch.deviceId || activeDeviceId || (activeDevices[0]&&activeDevices[0].id)||'',
            onChange: (event)=>{ setBatch((prev)=> ({...prev, deviceId: event.target.value})) },
          }, activeDevices.map((d)=> el('option', {key:d.id, value:d.id}, d.name)))),
          field('\u00a0', el('button', {
            type: 'button', className: 'dvb-btn dvb-btn-primary', onClick: generateBatch,
          }, t('batchGenerate')))))
      : null

    // ── points table ──
    const readRunning = runningOf(journal, 'read')
    const writeRunning = runningOf(journal, 'write')
    const tableRows = points.map((point) => {
      const rec = valueMap[point.id]
      const shown = rec && rec.ok && rec.raw !== null && rec.raw !== undefined
        ? decodeValue(point, typeof rec.raw === 'boolean' ? (rec.raw ? 1 : 0) : rec.raw)
        : (rec && rec.ok === false ? rec.error : '—')
      const writable = isWritableFunction(point.function)
      const devName = (devices.find((d)=>d.id===(point.deviceId||point.deviceId)) && devices.find((d)=>d.id===(point.deviceId)).name) || point.deviceId || '—'
      const isFocused = focusState && focusState.request && focusState.request.pointId === point.id
      return el('tr', { key: point.id, 'data-kind': 'pt', className: 'dvb-row' + focusHighlightClass(isFocused), 'data-focused': isFocused ? 'true' : 'false' },
        el('td', null, point.name || functionTag(point.function) + point.address),
        el('td', null, devName),
        el('td', null, functionTag(point.function)),
        el('td', { className: 'dvb-val' }, String(point.address)),
        el('td', { className: 'dvb-val' }, (point.scale === 1 ? '' : '×' + point.scale) + (point.offset ? (point.offset > 0 ? '+' : '') + point.offset : '') || '—'),
        el('td', null, point.unit || '—'),
        el('td', { className: 'dvb-val', 'data-ok': rec ? (rec.ok ? 'true' : 'false') : '' }, String(shown)),
        el('td', { className: 'dvb-val', 'data-ok': rec ? (rec.ok ? 'true' : 'false') : '' },
          rec && rec.at ? clockOf(rec.at) : '—'),
        writable
          ? el('td', null, el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-write',
            disabled: !cwd || !canDevice || connMissing || !!busy || writeRunning,
            onClick() { openWriteRow(point) },
          }, t('quickWrite')))
          : el('td', null, '—'),
        el('td', null, el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: !cwd || !!busy,
          onClick() { readOne(point.id) },
        }, busy === point.id ? t('reading') : t('readSegment'))),
        el('td', null, el('button', {
          type: 'button', className: 'dvb-btn',
          onClick() { openEditPoint(point) },
        }, t('editing').slice(0, 2))),
        el('td', null, el('button', {
          type: 'button', className: 'dvb-btn', disabled: !!busy,
          onClick() { removePointRow(point) },
        }, t('deleteSegment'))),
        el('td', null, el('button', {
          type: 'button', className: 'dvb-btn dvb-btn-sm',
          title: '复制结构化引用（稳定 ID+配置版本+时间范围）',
          onClick() { sendToAgent('point', { pointId: point.id, connectionId: point.connectionId, deviceId: point.deviceId, name: point.name }) },
        }, agentCopied === 'point:' + point.id ? '已复制' : '让 Agent 分析')),
        el('td', null, el('button', {
          type: 'button', className: 'dvb-btn dvb-btn-sm' + (isFocused ? ' is-on' : ''),
          title: 'Agent 聚焦此点位 · 支持临时监视组与返回原焦点',
          onClick() { requestFocusUi({ connectionId: point.connectionId, deviceId: point.deviceId, pointId: point.id, kind: 'point' }, { badgeOnly: false }) },
        }, '聚焦')))
    })

    const pointsPanel = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('pointTable') + ' · ' + (activeConnObj ? activeConnObj.name : '') + ' (' + points.length + ')'),
        el('button', {
          type: 'button', className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd || !activeConnId,
          onClick: openAddPoint,
        }, t('addPoint')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          onClick() { setBatch((prev) => ({ ...prev, open: !prev.open })) },
        }, t('batchAdd')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          onClick() { setCsvOpen((prev) => !prev) },
        }, t('csvImport')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: !points.length,
          onClick: exportCsv,
        }, csvNote || t('csvExport')),
        el('button', {
          type: 'button',
          className: 'dvb-btn',
          disabled: !cwd || !canDevice || connMissing || !points.length || !!busy || readRunning,
          onClick() { readAll() },
        }, busy === 'read' || (readRunning && busy !== 'read')
          ? (readRunning && runningSource(journal, 'read') === 'agent' ? t('agentReading') : t('reading'))
          : t('readAll')),
        el('button', {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary' + (watchEnabled ? ' is-on' : ''),
          disabled: !cwd || !canDevice || connMissing || !points.length,
          onClick: toggleWatch,
        }, watchEnabled ? t('liveStop') : t('liveStart')),
        watchEnabled
          ? el('select', {
            className: 'dvb-input dvb-live-interval',
            value: String(polling.intervalMs || 1000),
            onChange: (event)=>{ setPollingInterval(event.target.value) },
          }, POLL_INTERVALS.map((ms) => el('option', { key: String(ms), value: String(ms) }, (ms / 1000) + 's')))
          : null,
        !canDevice || connMissing
          ? el('span', { className: 'dvb-need' }, connMissing ? (conn.mode === 'tcp' ? t('needHost') : t('needSerial')) : t('needBindingsRead'))
          : null),
      batchPanel,
      csvOpen
        ? el('div', { className: 'dvb-write-panel' },
          el('div', { className: 'dvb-hint' }, t('csvReplaceHint')),
          el('textarea', {
            className: 'dvb-input dvb-csv-area',
            value: csvText,
            rows: 5,
            spellCheck: false,
            placeholder: 'name,function,address,scale,offset,unit,alarmMin,alarmMax',
            onChange: (event)=>{ setCsvText(event.target.value) },
          }),
          el('div', { className: 'dvb-actions' },
            el('button', {
              type: 'button', className: 'dvb-btn dvb-btn-primary',
              disabled: !csvText.trim(),
              onClick: importCsv,
            }, t('csvApply')),
            el('button', {
              type: 'button', className: 'dvb-btn',
              onClick() { setCsvOpen(false) },
            }, t('csvCancel'))))
        : null,
      points.length
        ? el('div', { className: 'dvb-table-wrap' },
          el('table', { className: 'dvb-table' },
            el('thead', null, el('tr', null,
              el('th', null, t('colName')),
              el('th', null, '设备'),
              el('th', null, t('colFn')),
              el('th', null, t('colAddr')),
              el('th', null, '×/+'),
              el('th', null, t('ptUnit')),
              el('th', null, '值'),
              el('th', null, t('time')),
              el('th', null, '写入'),
              el('th', null, '读取'),
              el('th', null, '编辑'),
              el('th', null, '删除'),
              el('th', null, '让 Agent 分析'),
              el('th', null, '聚焦'))),
            el('tbody', null, tableRows)))
        : el('div', { className: 'dvb-empty' }, t('noPoints')))

    // ── pending agent approvals ──
    const pendingPanel = pending.length
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-panel-head' },
          el('span', { className: 'dvb-panel-title' }, t('pendingWrites'))),
        pending.map((req) => el('div', { key: req.id, className: 'dvb-task' },
          el('span', { className: 'dvb-badge', 'data-source': 'agent' }, 'Agent'),
          el('span', { className: 'dvb-hint' }, req.label
            + (req.deviceName ? ' · ' + req.deviceName : '')
            + (req.endpointLabelStr ? ' · ' + req.endpointLabelStr : '')),
          el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
            onClick() { resolveWrite(req.id, true) },
          }, t('approveWrite')),
          el('button', {
            type: 'button', className: 'dvb-btn',
            onClick() { resolveWrite(req.id, false) },
          }, t('rejectWrite')))))
      : null

    function resolveWrite(id, approved) {
      post('/dsh-vision-bench/modbus/write/approve', { cwd, id, approved }, 120000).then((data) => {
        setPending((prev) => prev.filter((item) => item.id !== id))
        if (data && data.ok === false && !data.rejected) setError(data.error || t('fail'))
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
        }
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      })
    }

    // ── inline write strip under table ──
    const writeStrip = writeRow
      ? el('div', { className: 'dvb-write-inline' },
        el('div', { className: 'dvb-write-head' },
          el('span', { className: 'dvb-write-title' }, t('quickWrite') + ' · '
            + (writeRow.name || functionTag(writeRow.fn) + writeRow.address)
            + ' (' + functionTag(writeRow.fn) + '@' + writeRow.address + ')'),
          el('button', {
            type: 'button', className: 'dvb-btn',
            disabled: writeRow.busy,
            onClick() { setWriteRow(null) },
          }, t('writeClose'))),
        el('div', { className: 'dvb-write-form' },
          writeRow.fn === 1
            ? el('select', {
              className: 'dvb-input',
              value: String(Number(writeRow.text) ? 1 : 0),
              disabled: writeRow.busy,
              onChange: (event)=>{ setWriteRow((prev) => ({ ...prev, text: event.target.value })) },
            },
              el('option', { value: '0' }, t('coilOff')),
              el('option', { value: '1' }, t('coilOn')))
            : el('input', {
              className: 'dvb-input dvb-input-mono', type: 'number', min: 0, max: 65535,
              value: writeRow.text,
              disabled: writeRow.busy,
              spellCheck: false,
              onChange: (event)=>{ setWriteRow((prev) => ({ ...prev, text: event.target.value })) },
              onKeyDown(event) {
                if (event.key === 'Enter' && !writeRow.busy) submitWriteRow()
              },
            }),
          el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
            disabled: !cwd || writeRow.busy,
            onClick: submitWriteRow,
          }, writeRow.busy ? t('writing') : t('confirmWrite'))),
        writeRow.result
          ? (writeRow.result.ok === false
            ? el('div', { className: 'dvb-write-result', 'data-kind': 'err' },
              writeRow.result.summary || writeRow.result.error || t('fail'))
            : el('div', { className: 'dvb-write-result', 'data-kind': 'ok' },
              (writeRow.result.before && writeRow.result.before[0] !== null && writeRow.result.before[0] !== undefined ? String(writeRow.result.before[0]) : '—')
              + ' → ' + String(writeRow.result.target && writeRow.result.target[0])
              + ' → ' + (writeRow.result.readback && writeRow.result.readback[0] !== undefined ? String(writeRow.result.readback[0]) : '—')))
          : null)
      : null

    // ── connection tab bar [全部连接] [连接·COM/端点] [更多▼] [+] ──
    function connEndpointLabel(c) {
      const cc = c && c.conn || {}
      if (cc.mode === 'tcp') {
        if (c.role === 'server' || c.role === 'slave') return 'Listen :' + (cc.tcpPort || 502)
        return (cc.host || 'TCP') + ':' + (cc.tcpPort || 502)
      }
      return cc.port || '—'
    }
    function connTabLabel(c) {
      return c.name + ' · ' + connEndpointLabel(c)
    }
    function badgeForConn(connId) {
      const pts = (pack.points || []).filter((p) => (p.connectionId || p.connId) === connId)
      const ids = new Set(pts.map((p) => p.id))
      const anomaly = (pack.values || []).filter((v) => ids.has(v.key || v.pointId) && v.ok === false).length
      const pend = (pending || []).filter((r) => (r.connectionId || r.connId) === connId).length
      const running = (journal && journal.running ? journal.running.filter((x) => x && x.status === 'running') : []).length
      // Only show running badge on active connection to avoid clutter, but still compute
      return { anomaly, pend, running: connId === activeConnId ? running : 0 }
    }
    const MAX_VISIBLE_TABS = 6
    const visibleConns = connections.length > MAX_VISIBLE_TABS ? connections.slice(0, MAX_VISIBLE_TABS) : connections
    const overflowConns = connections.length > MAX_VISIBLE_TABS ? connections.slice(MAX_VISIBLE_TABS) : []
    function handleTabKeyDown(e) {
      if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
        e.preventDefault()
        const order = ['all'].concat(connections.map((c) => c.id))
        const idx = order.indexOf(hmiTab)
        let nextIdx = idx
        if (e.key === 'ArrowRight') nextIdx = (idx + 1) % order.length
        if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + order.length) % order.length
        const nid = order[nextIdx]
        if (nid === 'all') setHmiTab('all')
        else selectConnection(nid)
      } else if (e.key === 'Home') {
        e.preventDefault()
        setHmiTab('all')
      } else if (e.key === 'End') {
        e.preventDefault()
        const last = connections[connections.length - 1]
        if (last) selectConnection(last.id)
      }
    }
    const tabBar = el('div', { className: 'dvb-hmi-tabs', role: 'tablist', onKeyDown: handleTabKeyDown },
      el('button', {
        type: 'button',
        role: 'tab',
        'aria-selected': hmiTab === 'all' ? 'true' : 'false',
        className: 'dvb-tab' + (hmiTab === 'all' ? ' is-on' : ''),
        onClick() { setHmiTab('all'); setMoreOpen(false) },
      }, '全部连接'),
      visibleConns.map((c) => {
        const isActive = hmiTab === c.id
        const b = badgeForConn(c.id)
        const occupied = c.conn && c.conn.mode === 'rtu' && c.conn.port ? findRtuOccupier(c.conn.port, c.id) : (c.conn && c.conn.mode === 'tcp' ? findTcpOccupier(c.conn.host, c.conn.tcpPort, c.id) : null)
        return el('button', {
          key: c.id,
          type: 'button',
          role: 'tab',
          'aria-selected': isActive ? 'true' : 'false',
          className: 'dvb-tab' + (isActive ? ' is-on' : '') + (occupied ? ' is-warn' : ''),
          title: c.name + ' · ' + connLabel(c.conn || {}) + (occupied ? ' · COM冲突: ' + occupied : ''),
          onClick() { selectConnection(c.id) },
        },
          el('span', { className: 'dvb-tab-label' }, connTabLabel(c)),
          isActive ? el('span', { className: 'dvb-tab-dot', 'data-kind': c.enabled === false ? 'idle' : (pending.length ? 'warn' : 'live') }) : null,
          (b.anomaly || b.pend || b.running) ? el('span', { className: 'dvb-tab-badges' },
            b.anomaly ? el('span', { className: 'dvb-badge', 'data-kind': 'err' }, String(b.anomaly)) : null,
            b.running ? el('span', { className: 'dvb-badge', 'data-kind': 'live' }, String(b.running)) : null,
            b.pend ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, String(b.pend)) : null,
          ) : null,
        )
      }),
      overflowConns.length
        ? el('div', { className: 'dvb-tab-more' },
          el('button', {
            type: 'button',
            className: 'dvb-tab' + (overflowConns.some((c) => c.id === hmiTab) ? ' is-on' : ''),
            onClick() { setMoreOpen((v) => !v) },
          }, '更多▼'),
          moreOpen ? el('div', { className: 'dvb-tab-dropdown' },
            overflowConns.map((c) => {
              const isActive = hmiTab === c.id
              const b = badgeForConn(c.id)
              return el('button', {
                key: c.id,
                type: 'button',
                className: 'dvb-tab' + (isActive ? ' is-on' : ''),
                onClick() { selectConnection(c.id); setMoreOpen(false) },
              },
                el('span', null, connTabLabel(c)),
                (b.anomaly || b.pend || b.running) ? el('span', { className: 'dvb-tab-badges' },
                  b.anomaly ? el('span', { className: 'dvb-badge', 'data-kind': 'err' }, String(b.anomaly)) : null,
                  b.pend ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, String(b.pend)) : null,
                ) : null,
              )
            })
          ) : null,
        )
        : null,
      el('button', {
        type: 'button',
        className: 'dvb-tab dvb-tab-add',
        title: '新建连接',
        disabled: !cwd,
        onClick: addConnection,
      }, '+')
    )

    // 全部连接视图：仅管理表
    if (hmiTab === 'all') {
      return el('div', { className: 'dvb-page' },
        statusBar(el, t, cwd, [{ key: 'python', health: health.python }]),
        visionCollabBar(el, t, { cwd, workspace, journal, pendingWrites: pending, sessionId }),
        error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
        agentCopied ? el('div', { className: 'dvb-msg', 'data-kind': 'ok' }, '已复制「让 Agent 分析」引用 · 粘贴到会话中让 Agent 分析') : null,
        tabBar,
        focusBanner,
        connListPanel,
        connFormPanel,
        journalPanel(el, t, journal))
    }

    return el('div', { className: 'dvb-page' },
      statusBar(el, t, cwd, [{ key: 'python', health: health.python }]),
      visionCollabBar(el, t, { cwd, workspace, journal, pendingWrites: pending, sessionId }),
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      agentCopied ? el('div', { className: 'dvb-msg', 'data-kind': 'ok' }, '已复制「让 Agent 分析」引用 ' + agentCopied + ' · 粘贴到会话中让 Agent 分析') : null,
      tabBar,
      focusBanner,
      activeConnDetail,
      devicePanel,
      pointsPanel,
      formPanel,
      writeStrip,
      pendingPanel,
      serialPanel,
      journalPanel(el, t, journal))
  }
}
