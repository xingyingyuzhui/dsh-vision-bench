import { normalizeModbus } from '../../../bench-devices.mjs'
import { canUseModbus, ioRuntimeStatus } from '../../../bench-io-capability.mjs'
import { csvToPoints, encodeValue, normalizeWriteValues, pointsToCsv } from '../../../bench-points.mjs'
import {
  buildAgentRef,
  buildInputBridge,
  clearFramesLog,
  dispatchAgentRef,
  evidenceFromRef,
  hasHarnessInput,
  postEvidence,
  pushFramesLog,
  readInputDraft,
  setFocusState,
  setTempWatch,
} from '../../../bench-shared.mjs'
import {
  emptyJournal,
  emptyWorkspace,
  pickJournal,
  runningOf,
  statusBar,
  subscribeState,
  useSessionCwd,
  visionCollabBar,
} from '../../../bench-shared.mjs'
import { renderConnectionForm } from './connection-form.mjs'
import { renderConnectionPanel } from './connection-panel.mjs'
import { renderConnectionTabs } from './connection-tabs.mjs'
import { renderDeviceCards } from './device-card.mjs'
import { renderDeviceForm } from './device-form.mjs'
import {
  renderDraftPanel,
  renderField,
  renderFocusToast,
  renderPendingPanel,
  rtuOccupierAmong,
  tcpOccupierAmong,
} from './hmi-controller.mjs'
import { AREA_BY_FN_EDIT, hmiGenId } from './hmi-ids.mjs'

export function createHmiView(React, t, post) {
  return function HmiView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = props?.sessionId || ''
    // Task5/0.18.2: hook reads at render top-level, passed into the pure dispatch bridge
    const inputDraft = readInputDraft(props?.useInput)
    const agentBridge = buildInputBridge(props, inputDraft)
    const [health, setHealth] = React.useState({})
    const [ioRuntime, setIoRuntime] = React.useState({})
    const [workspace, setWorkspace] = React.useState(emptyWorkspace)
    const [journal, setJournal] = React.useState(emptyJournal)
    const [busy, setBusy] = React.useState('')
    const [error, setError] = React.useState('')
    const [ports, setPorts] = React.useState([])
    const [scanning, setScanning] = React.useState(false)
    const [pending, setPending] = React.useState([])
    // Task1/0.19.3: 点位表单打开时固定 connectionId/deviceId，不依赖全局激活状态
    // TaskP1/0.20.0: 行内编辑/行内写入 — 草稿固定携带 connectionId/deviceId/pointId
    const [editingDeviceId, setEditingDeviceId] = React.useState('')
    const [editingPointsDeviceId, setEditingPointsDeviceId] = React.useState('')
    const [deviceDraft, setDeviceDraft] = React.useState(null)
    const [pointDraftsById, setPointDraftsById] = React.useState({})
    const [newPointDraft, setNewPointDraft] = React.useState(null)
    const [inlineWrite, setInlineWrite] = React.useState(null)
    const [batch, setBatch] = React.useState({ open: false, deviceId: '', prefix: '', fc: 3, start: 0, count: 5 })
    const [devForm, setDevForm] = React.useState({ open: false, id: '', name: '', unitId: 1 })
    const [devDeleteId, setDevDeleteId] = React.useState('')
    const [csvText, setCsvText] = React.useState('')
    const [csvTarget, setCsvTarget] = React.useState({ deviceId: '', open: false, mode: 'merge' })
    const [csvNote, setCsvNote] = React.useState('')
    const [connectionStates, setConnectionStates] = React.useState([])
    const [linkBusy, setLinkBusy] = React.useState('')
    const [draftBusy, setDraftBusy] = React.useState('')
    const [draftNote, setDraftNote] = React.useState('')
    const [flagSavingByPoint, setFlagSavingByPoint] = React.useState({})
    const flagRequestSeq = React.useRef({})

    const [connForm, setConnForm] = React.useState({
      open: false,
      id: '',
      name: '',
      role: 'client',
      enabled: true,
      conn: {
        mode: 'rtu',
        port: '',
        baudrate: 9600,
        bytesize: 8,
        parity: 'N',
        stopbits: 1,
        host: '',
        tcpPort: 502,
        sim: false,
      },
    })
    const [pendingDeleteId, setPendingDeleteId] = React.useState('')
    const [frameFilter, setFrameFilter] = React.useState('all')
    const [hmiTab, setHmiTab] = React.useState('all')
    const [moreOpen, setMoreOpen] = React.useState(false)
    const [focusState, setFocusUi] = React.useState({
      request: null,
      prev: null,
      tempWatchIds: [],
      badgeOnly: false,
      evidence: [],
    })
    const [agentCopied, setAgentCopied] = React.useState('')
    const [tempWatchNote, setTempWatchNote] = React.useState('')
    const lastDeviceByConn = React.useRef({})
    const workspaceRef = React.useRef(workspace)
    workspaceRef.current = workspace
    const inflight = React.useRef(0)
    const flagInflight = React.useRef(0)

    const field = (label, control) => renderField(el, t, { label, control })

    function scanPorts() {
      setScanning(true)
      post('/dsh-vision-bench/serial/ports', {}, 30000)
        .then((data) => {
          setPorts(data && Array.isArray(data.ports) ? data.ports : [])
        })
        .catch(() => setPorts([]))
        .finally(() => setScanning(false))
    }

    React.useEffect(() => {
      scanPorts()
    }, [cwd])

    React.useEffect(
      () =>
        subscribeState(
          post,
          cwd,
          (data) => {
            if (!data) return
            if (data.health) setHealth(data.health)
            if (data.ioRuntime) setIoRuntime(data.ioRuntime)
            if (Array.isArray(data.connectionStates)) setConnectionStates(data.connectionStates)
            if (Array.isArray(data.pendingWrites)) setPending(data.pendingWrites)
            setJournal(pickJournal(data))
            if (data.workspace?.focus) {
              setFocusUi(data.workspace.focus)
              try {
                setFocusState(cwd, data.workspace.focus)
              } catch {}
            }
            if (inflight.current > 0 || flagInflight.current > 0) return
            if (data.workspace) {
              setWorkspace((prev) => ({
                ...prev,
                modbus: data.workspace.modbus || prev.modbus,
                focus: data.workspace.focus || prev.focus,
                configDrafts: data.workspace.configDrafts || prev.configDrafts || [],
              }))
              if (data.workspace.configDrafts) {
                // also keep workspaceRef in sync for cfgVersion
                workspaceRef.current = {
                  ...workspaceRef.current,
                  configDrafts: data.workspace.configDrafts,
                  modbus: data.workspace.modbus || workspaceRef.current.modbus,
                }
              }
            }
          },
          { sessionId },
        ),
      [cwd, sessionId],
    )

    // Task14: 显式 focus 且 foreground 显式时才切换连接/设备/高亮；badgeOnly 仅角标
    React.useEffect(() => {
      if (!cwd || !focusState.request || focusState.badgeOnly) return
      const r = focusState.request
      const pack = normalizePack()
      if (r.connectionId && r.connectionId !== pack.activeConnectionId) {
        // 无效组合已在服务端拦截，这里仅对有效目标做半完成防护
        if (pack.connections.some((c) => c.id === r.connectionId)) {
          selectConnection(r.connectionId)
        }
      } else if (r.deviceId && r.deviceId !== pack.activeDeviceId) {
        if (
          pack.devices.some(
            (d) => d.id === r.deviceId && d.connectionId === (r.connectionId || pack.activeConnectionId),
          )
        ) {
          persist({ activeDeviceId: r.deviceId, version: 3 })
        }
      }
      if (r.pointId || r.frameId) {
        setFrameFilter(r.connectionId || pack.activeConnectionId || 'all')
      }
    }, [
      cwd,
      focusState.request?.connectionId,
      focusState.request?.deviceId,
      focusState.request?.pointId,
      focusState.request?.frameId,
      focusState.badgeOnly,
    ])

    // Task8/0.19.2: 高亮与轻提示只短暂停留（3~5 秒），随后自动回到常态
    React.useEffect(() => {
      if (!focusState.request || focusState.badgeOnly) return
      const timer = setTimeout(() => {
        setFocusUi((prev) =>
          prev?.request
            ? { request: null, prev: prev.request, tempWatchIds: [], badgeOnly: false, evidence: [] }
            : prev,
        )
      }, 5000)
      return () => clearTimeout(timer)
    }, [
      focusState.request?.connectionId,
      focusState.request?.deviceId,
      focusState.request?.pointId,
      focusState.request?.frameId,
    ])

    function normalizePack() {
      const mb = workspaceRef.current.modbus || emptyWorkspace().modbus
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
          if (
            k === 'connections' ||
            k === 'devices' ||
            k === 'points' ||
            k === 'values' ||
            k === 'pollingByConnection' ||
            k === 'framesByConnection' ||
            k === 'activeConnectionId' ||
            k === 'activeDeviceId' ||
            k === 'alarmState' ||
            k === 'alarmActive' ||
            k === 'version'
          ) {
            next.modbus[k] = modbusPatch[k]
          } else if (k === 'conn' || k === 'polling') {
            // 保留给 bench-store 做定向映射，本地也做一份便于立即显示
            if (k === 'conn') {
              next.modbus.conn = { ...(next.modbus.conn || {}), ...modbusPatch.conn }
            } else {
              next.modbus.polling = { ...(next.modbus.polling || {}), ...modbusPatch.polling }
            }
          } else {
            next.modbus[k] = modbusPatch[k]
          }
        }
        workspaceRef.current = next
        return next
      })
      return post('/dsh-vision-bench/workspace', { cwd, modbus: modbusPatch })
        .then((data) => {
          if (seq === inflight.current && data && data.workspace && data.workspace.modbus) {
            setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus }))
            workspaceRef.current = { ...workspaceRef.current, modbus: data.workspace.modbus }
          }
          if (data) setJournal(pickJournal(data))
          if (data && data.ok === false && data.error) setError(data.error)
        })
        .catch((err) => {
          setError(String(err?.message || t('fail')))
        })
        .finally(() => {
          if (seq === inflight.current) inflight.current = 0
        })
    }

    function cfgVersion() {
      try {
        return normalizePack().configVersion || 1
      } catch {
        return 1
      }
    }

    function agentRefFor(kind, payload) {
      const pack = normalizePack()
      return buildAgentRef(kind, payload, { configVersion: pack.configVersion || 1 })
    }

    function sendToAgent(kind, payload) {
      const ref = agentRefFor(kind, payload)
      Promise.resolve(dispatchAgentRef(ref, agentBridge))
        .then((res) => {
          const key =
            kind +
            ':' +
            ((payload &&
              (payload.id || payload.pointId || payload.frameId || payload.connectionId || payload.deviceId)) ||
              '')
          const status = res?.ok ? res.status || res.mode : '处理失败'
          setAgentCopied(key + ':' + (res?.mode || 'failed') + ':' + status)
          setTimeout(() => setAgentCopied(''), 2500)
        })
        .catch(() => {})
      try {
        postEvidence(post, cwd, evidenceFromRef(ref), (reason) => setError(reason))
      } catch {}
      return ref
    }

    function agentBtnLabel(k, p) {
      const key = k + ':' + ((p && (p.id || p.pointId || p.frameId || p.connectionId)) || '')
      if (agentCopied.startsWith(key + ':'))
        return (
          agentCopied
            .slice(key.length + 1)
            .split(':')
            .slice(1)
            .join(':') || '仅复制'
        )
      return hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent'
    }

    function requestFocusUi(target, opts) {
      if (!cwd) return
      const pack = normalizePack()
      const payload = {
        cwd,
        target: target || {},
        tempWatchIds: opts?.tempWatchIds || [],
        evidence: opts?.evidence || [],
        badgeOnly: !!opts?.badgeOnly,
        foreground: !opts?.badgeOnly,
      }
      post('/dsh-vision-bench/focus', payload, 15000).catch((e) => setError(String(e?.message || t('fail'))))
    }

    function returnToPrevFocus() {
      const prev = focusState?.prev
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

    // ── connection list operations（Task1/0.19.3：只建连接，不自动生成设备）──
    function addConnection() {
      const pack = normalizePack()
      const nid = hmiGenId('c')
      const newConn = {
        id: nid,
        name: '连接' + (pack.connections.length + 1),
        role: 'client',
        enabled: true,
        conn: {
          mode: 'rtu',
          port: '',
          baudrate: 9600,
          bytesize: 8,
          parity: 'N',
          stopbits: 1,
          host: '',
          tcpPort: 502,
          sim: false,
        },
      }
      const nextConns = (pack.connections || []).concat([newConn])
      const nextPolling = {
        ...(pack.pollingByConnection || {}),
        [nid]: { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' },
      }
      const nextFrames = { ...(pack.framesByConnection || {}), [nid]: [] }
      persist({
        connections: nextConns,
        devices: pack.devices || [],
        pollingByConnection: nextPolling,
        framesByConnection: nextFrames,
        activeConnectionId: nid,
        activeDeviceId: '',
        version: 3,
      })
      setHmiTab(nid)
      lastDeviceByConn.current[nid] = ''
      setFrameFilter(nid)
      setDevForm({ open: true, id: '', name: '', unitId: 1 })
    }

    // ── Task1/0.19.3: 设备表单 — 名称 + Unit ID（连接内唯一），禁止直接生成 Unit 1 ──
    function openAddDevice() {
      setError('')
      setDevForm({
        open: true,
        id: '',
        name: '',
        unitId: activeDevices.length ? Math.max(...activeDevices.map((d) => d.unitId || 1)) + 1 : 1,
      })
    }
    function openEditDevice(dev) {
      setError('')
      setDevForm({ open: true, id: dev.id, name: dev.name, unitId: dev.unitId })
    }
    function saveDeviceForm() {
      const pack = normalizePack()
      const name = String(devForm.name || '')
        .trim()
        .slice(0, 40)
      if (!name) {
        setError('请填写设备名称')
        return
      }
      const unitId = Math.trunc(Number(devForm.unitId))
      if (!Number.isFinite(unitId) || unitId < 1 || unitId > 247) {
        setError('站号 1–247')
        return
      }
      const dupUnit = (pack.devices || []).some(
        (d) => d.connectionId === activeConnId && d.id !== devForm.id && d.unitId === unitId,
      )
      if (dupUnit) {
        setError('该连接内站号 ' + unitId + ' 已存在')
        return
      }
      if (devForm.id) {
        persist({
          devices: (pack.devices || []).map((d) => (d.id === devForm.id ? { ...d, name, unitId } : d)),
          version: 3,
        })
      } else {
        const nid = hmiGenId('d')
        persist({
          devices: (pack.devices || []).concat([{ id: nid, connectionId: activeConnId, name, unitId, enabled: true }]),
          activeDeviceId: nid,
          version: 3,
        })
        lastDeviceByConn.current[activeConnId] = nid
      }
      setDevForm((prev) => ({ ...prev, open: false }))
    }
    function requestDeleteDevice(dev) {
      const pack = normalizePack()
      const n = (pack.points || []).filter(
        (p) => (p.deviceId || '') === dev.id && (p.connectionId || p.connId) === activeConnId,
      ).length
      const vn = (pack.values || []).filter(
        (v) =>
          (v.pointId || v.key) &&
          pack.points.some((p) => p.id === (v.pointId || v.key) && (p.deviceId || '') === dev.id),
      ).length
      setDevDeleteId(dev.id + '|' + n + '|' + vn)
    }
    function confirmDeleteDevice(dev) {
      const pack = normalizePack()
      const gone = new Set(
        (pack.points || [])
          .filter((p) => (p.deviceId || '') === dev.id && (p.connectionId || p.connId) === activeConnId)
          .map((p) => p.id),
      )
      const nextDevices = (pack.devices || []).filter((d) => d.id !== dev.id)
      persist({
        devices: nextDevices,
        points: (pack.points || []).filter((p) => !gone.has(p.id)),
        values: (pack.values || []).filter((v) => !gone.has(v.pointId || v.key)),
        activeDeviceId: nextDevices.some((d) => d.id === pack.activeDeviceId)
          ? pack.activeDeviceId
          : nextDevices[0]
            ? nextDevices[0].id
            : '',
        version: 3,
      })
      setDevDeleteId('')
    }

    function selectConnection(connId) {
      const pack = normalizePack()
      // restore last device for this connection if any
      let targetDevId = lastDeviceByConn.current[connId]
      if (!targetDevId || !(pack.devices || []).some((d) => d.id === targetDevId && d.connectionId === connId)) {
        const devFor = (pack.devices || []).find((d) => d.connectionId === connId)
        targetDevId = devFor ? devFor.id : pack.devices[0]?.id || ''
      }
      persist({ activeConnectionId: connId, activeDeviceId: targetDevId, version: 3 })
      setPendingDeleteId('')
      setHmiTab(connId)
      setMoreOpen(false)
      setFrameFilter(connId)
    }

    function requestDeleteConnection(connId) {
      if (pendingDeleteId !== connId) {
        setPendingDeleteId(connId)
        return
      }
      const pack = normalizePack()
      if ((pack.connections || []).length <= 1) {
        setError('至少保留一个连接')
        setPendingDeleteId('')
        return
      }
      const nextConns = (pack.connections || []).filter((c) => c.id !== connId)
      const nextDevs = (pack.devices || []).filter((d) => d.connectionId !== connId)
      const nextPoints = (pack.points || []).filter((p) => (p.connectionId || p.connId) !== connId)
      const nextValues = (pack.values || []).filter((v) => {
        const pid = v.key || v.pointId
        return !!nextPoints.some((pt) => pt.id === pid)
      })
      // 保留仍存在的 values（更简单：过滤掉被删连接关联的 points 对应的 values）
      const keptValues = (pack.values || []).filter((v) => {
        const pt = (pack.points || []).find((p) => p.id === (v.key || v.pointId))
        return pt && (pt.connectionId || pt.connId) !== connId
      })
      const nextPolling = { ...(pack.pollingByConnection || {}) }
      delete nextPolling[connId]
      const nextFrames = { ...(pack.framesByConnection || {}) }
      delete nextFrames[connId]
      let nextActive = pack.activeConnectionId
      let nextActiveDev = pack.activeDeviceId
      if (nextActive === connId) {
        nextActive = nextConns[0]?.id || ''
        const devFor = (nextDevs || []).find((d) => d.connectionId === nextActive)
        nextActiveDev = devFor ? devFor.id : nextDevs[0]?.id || ''
        setFrameFilter(nextActive || 'all')
        setHmiTab(nextActive || 'all')
      }
      clearFramesLog(cwd, connId)
      setPendingDeleteId('')
      persist({
        connections: nextConns,
        devices: nextDevs,
        points: nextPoints,
        values: keptValues,
        pollingByConnection: nextPolling,
        framesByConnection: nextFrames,
        activeConnectionId: nextActive,
        activeDeviceId: nextActiveDev,
        version: 3,
      })
    }

    function openConnEdit(conn) {
      setConnForm({
        open: true,
        id: conn.id,
        name: conn.name,
        role: conn.role,
        enabled: conn.enabled !== false,
        conn: { ...(conn.conn || {}) },
      })
    }

    function saveConnEdit() {
      const pack = normalizePack()
      const targetId = connForm.id
      // 连接编辑只改端点参数；禁止改写任何设备 Unit ID
      const nextConns = (pack.connections || []).map((c) =>
        c.id === targetId
          ? {
              ...c,
              name: connForm.name.slice(0, 40),
              role: connForm.role === 'server' || connForm.role === 'slave' ? 'server' : 'client',
              enabled: true,
              conn: {
                ...(c.conn || {}),
                mode: connForm.conn.mode === 'tcp' ? 'tcp' : 'rtu',
                port: String(connForm.conn.port || '').trim(),
                baudrate: Number(connForm.conn.baudrate) || 9600,
                bytesize: Number(connForm.conn.bytesize) === 7 ? 7 : 8,
                parity: ['N', 'E', 'O'].includes(connForm.conn.parity) ? connForm.conn.parity : 'N',
                stopbits: Number(connForm.conn.stopbits) === 2 ? 2 : 1,
                host: String(connForm.conn.host || '').trim(),
                tcpPort: Math.max(1, Math.min(65535, Number(connForm.conn.tcpPort) || 502)),
                sim: !!connForm.conn.sim,
              },
            }
          : c,
      )
      setConnForm((prev) => ({ ...prev, open: false }))
      persist({ connections: nextConns, version: 3 })
    }

    function setActiveConnPatch(patch) {
      const pack = normalizePack()
      const aid = pack.activeConnectionId
      if (!aid) return
      const raw = { ...(patch || {}) }
      raw.slave = undefined
      const nextConns = (pack.connections || []).map((c) =>
        c.id === aid ? { ...c, conn: { ...(c.conn || {}), ...raw } } : c,
      )
      persist({ connections: nextConns, version: 3 })
    }

    function updateActiveConnMeta(patch) {
      const pack = normalizePack()
      const aid = pack.activeConnectionId
      const nextConns = (pack.connections || []).map((c) => (c.id === aid ? { ...c, ...patch } : c))
      persist({ connections: nextConns, version: 3 })
    }

    // ── point form（Task1/0.19.3：打开表单时固定 connectionId/deviceId）──
    function generateBatch() {
      const pack = normalizePack()
      const fixedCid = batch.connectionId || pack.activeConnectionId || pack.connections[0]?.id || ''
      const fixedDid = batch.deviceId
      if (!fixedDid) {
        setError('请先选择设备')
        return
      }
      const count = Math.max(1, Math.min(Number(batch.count) || 1, 64))
      const existingIds = new Set(
        (pack.points || [])
          .filter((p) => (p.connectionId || p.connId) === fixedCid && (p.deviceId || '') === fixedDid)
          .map((p) => p.id),
      )
      const existingAddr = new Set(
        (pack.points || [])
          .filter(
            (p) =>
              (p.connectionId || p.connId) === fixedCid &&
              (p.deviceId || '') === fixedDid &&
              p.function === Number(batch.fc),
          )
          .map((p) => p.address),
      )
      const additions = []
      for (let i = 0; i < count; i++) {
        const address = Number(batch.start) + i
        if (existingAddr.has(address)) continue
        const id = hmiGenId('p')
        if (existingIds.has(id)) continue
        additions.push({
          id,
          connectionId: fixedCid,
          connId: fixedCid,
          deviceId: fixedDid,
          name: (batch.prefix || '') + i,
          function: Number(batch.fc),
          address,
          area: Number(batch.fc) === 1 ? 'coil' : 'holdingRegister',
          scale: 1,
          offset: 0,
          unit: '',
          trendEnabled: false,
          alarmMin: null,
          alarmMax: null,
        })
      }
      if (!additions.length) {
        setError('批量点位的地址全部与现有点位重复')
        return
      }
      setError('')
      setBatch((prev) => ({ ...prev, open: false }))
      persist({ points: (pack.points || []).concat(additions), version: 3 })
    }

    function removePointRow(point) {
      const pack = normalizePack()
      persist({
        points: (pack.points || []).filter((p) => p.id !== point.id),
        values: (pack.values || []).filter((v) => (v.key || v.pointId) !== point.id),
        version: 3,
      })
    }

    // ── reads ──
    function readAll(deviceId) {
      readOne(null, deviceId || undefined)
    }

    function readOne(pointId, deviceId) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return
      }
      const pack = normalizePack()
      const activeConnId = pack.activeConnectionId || pack.connections[0]?.id || 'c1'
      setBusy(pointId || deviceId || 'read')
      setError('')
      post(
        '/dsh-vision-bench/modbus/read',
        {
          cwd,
          source: 'user',
          sessionId,
          all: !pointId,
          pointId: pointId || undefined,
          deviceId: deviceId || undefined,
        },
        120000,
      )
        .then((data) => {
          if (!data) return
          // 报文分轨：按 activeConnId 切轨
          pushFramesLog(cwd, activeConnId, data.framesLog || data.frames || [])
          if (Array.isArray(data.values)) {
            setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
            workspaceRef.current = {
              ...workspaceRef.current,
              modbus: { ...workspaceRef.current.modbus, values: data.values },
            }
          }
          if (data.ok === false && data.error) setError(data.error)
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          if (!data) return
          setJournal(pickJournal(data))
          if (data.workspace?.modbus) {
            setWorkspace((prev) => ({
              ...prev,
              modbus: { ...prev.modbus, values: data.workspace.modbus.values || prev.modbus.values },
            }))
          }
        })
        .catch((err) => {
          setError(String(err?.message || t('fail')))
        })
        .finally(() => setBusy(''))
    }

    // ── inline write ──
    // ── TaskP1/0.20.0 行内写入：固定 connectionId/deviceId/pointId，工程值输入 ──
    function openWriteCell(point) {
      setError('')
      setNewPointDraft(null)
      const pack = normalizePack()
      const rec = (pack.values || []).find((item) => (item.key || item.pointId) === point.id)
      // 输入与显示均为工程值
      const currentEng = rec?.ok && rec.value != null ? String(rec.value) : ''
      setInlineWrite({
        connectionId: point.connectionId,
        deviceId: point.deviceId,
        pointId: point.id,
        function: point.function,
        address: point.address,
        scale: point.scale,
        offset: point.offset,
        unit: point.unit || '',
        text: currentEng,
        busy: false,
        result: null,
      })
    }

    function submitWriteCell(rawOverride) {
      const row = inlineWrite
      if (!row || !cwd) return
      let raw
      if (row.function === 1) {
        // FC01 开/关语义
        raw = rawOverride === true ? 1 : rawOverride === false ? 0 : Number(row.text) ? 1 : 0
      } else {
        const enc = encodeValue({ scale: row.scale, offset: row.offset }, row.text)
        if (!enc.ok) {
          setInlineWrite((prev) => ({ ...prev, result: { ok: false, error: enc.error } }))
          return
        }
        raw = enc.raw
      }
      const check = normalizeWriteValues(row.function, [raw], 1)
      if (!check.ok) {
        setInlineWrite((prev) => ({ ...prev, result: { ok: false, error: check.error } }))
        return
      }
      setInlineWrite((prev) => ({ ...prev, busy: true, result: null }))
      post(
        '/dsh-vision-bench/modbus/write',
        {
          cwd,
          source: 'user',
          sessionId,
          connectionId: row.connectionId,
          deviceId: row.deviceId,
          pointId: row.pointId,
          function: row.function,
          address: row.address,
          values: [raw],
        },
        60000,
      )
        .then((data) => {
          setInlineWrite((prev) => ({ ...prev, busy: false, result: data }))
          pushFramesLog(cwd, row.connectionId, (data && (data.framesLog || data.frames)) || [])
          if (Array.isArray(data.values)) {
            setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
            workspaceRef.current = {
              ...workspaceRef.current,
              modbus: { ...workspaceRef.current.modbus, values: data.values },
            }
          }
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          if (!data) return
          setJournal(pickJournal(data))
          if (data.workspace?.modbus) {
            setWorkspace((prev) => ({
              ...prev,
              modbus: { ...prev.modbus, values: data.workspace.modbus.values || prev.modbus.values },
            }))
          }
        })
        .catch((err) => {
          setInlineWrite((prev) => ({
            ...prev,
            busy: false,
            result: { ok: false, error: String(err?.message || t('fail')) },
          }))
        })
    }

    // ── TaskP1/0.20.0 行内编辑草稿：设备编辑与点位编辑分离 ──
    function enterDeviceEdit(d) {
      setError('')
      setNewPointDraft(null)
      setEditingPointsDeviceId('')
      setPointDraftsById({})
      setEditingDeviceId(d.id)
      setDeviceDraft({ id: d.id, name: d.name, unitId: d.unitId, connectionId: d.connectionId })
    }

    function enterPointsEdit(d) {
      setError('')
      setNewPointDraft(null)
      setEditingDeviceId('')
      setDeviceDraft(null)
      setEditingPointsDeviceId(d.id)
      const drafts = {}
      for (const pt of pointsOfDevice(d.id)) {
        drafts[pt.id] = {
          id: pt.id,
          connectionId: pt.connectionId,
          deviceId: pt.deviceId,
          name: pt.name || '',
          function: pt.function,
          area: pt.area || AREA_BY_FN_EDIT[pt.function] || 'holdingRegister',
          address: pt.address,
          scale: pt.scale,
          offset: pt.offset,
          unit: pt.unit || '',
          alarmMin: pt.alarmMin == null ? '' : String(pt.alarmMin),
          alarmMax: pt.alarmMax == null ? '' : String(pt.alarmMax),
        }
      }
      setPointDraftsById(drafts)
    }

    function patchDraft(pointId, patch) {
      setPointDraftsById((prev) => {
        const cur = { ...(prev[pointId] || {}), ...patch }
        // 功能码变更必须同步 area，否则 normalize 会按旧 area 盖回 function
        if (patch.function !== undefined) {
          const fn = Math.trunc(Number(patch.function))
          if (AREA_BY_FN_EDIT[fn]) cur.area = AREA_BY_FN_EDIT[fn]
          cur.function = fn
        }
        return { ...prev, [pointId]: cur }
      })
    }

    function applyPointFlagLocal(pointId, patch) {
      setWorkspace((prev) => {
        const points = prev.modbus?.points || []
        const nextPoints = points.map((p) => {
          if (p.id !== pointId) return p
          const next = { ...p, ...patch }
          if (patch.monitorEnabled !== undefined) next.trendEnabled = patch.monitorEnabled === true
          return next
        })
        const next = { ...prev, modbus: { ...prev.modbus, points: nextPoints } }
        workspaceRef.current = next
        return next
      })
    }

    function validateAlarmEnable(point) {
      const minRaw = point?.alarmMin
      const maxRaw = point?.alarmMax
      const hasMin = minRaw !== null && minRaw !== undefined && minRaw !== ''
      const hasMax = maxRaw !== null && maxRaw !== undefined && maxRaw !== ''
      if (!hasMin && !hasMax) return { ok: true, warn: '尚未配置阈值' }
      if (hasMin && hasMax) {
        const min = Number(minRaw)
        const max = Number(maxRaw)
        if (!(Number.isFinite(min) && Number.isFinite(max) && min < max)) {
          return { ok: false, error: '告警上下限非法，无法开启' }
        }
      }
      return { ok: true }
    }

    function persistPointFlags(pointId, patch) {
      if (!cwd || !pointId || !patch || typeof patch !== 'object') return Promise.resolve()
      const keys = Object.keys(patch).filter((k) => k === 'monitorEnabled' || k === 'alarmEnabled')
      if (!keys.length) return Promise.resolve()

      const packNow = normalizePack()
      const current = (packNow.points || []).find((p) => p.id === pointId)
      if (!current) {
        setError('点位不存在')
        return Promise.resolve()
      }

      if (patch.alarmEnabled === true) {
        const check = validateAlarmEnable(current)
        if (!check.ok) {
          setError(check.error)
          return Promise.resolve()
        }
        if (check.warn) setError(check.warn)
      }

      const prevSnapshot = {
        monitorEnabled: current.monitorEnabled === true,
        alarmEnabled: current.alarmEnabled === true,
        trendEnabled: current.trendEnabled === true,
      }
      const seqKeys = keys.map((k) => pointId + ':' + k)
      for (const sk of seqKeys) {
        flagRequestSeq.current[sk] = (flagRequestSeq.current[sk] || 0) + 1
      }
      const seqAtStart = Object.fromEntries(seqKeys.map((sk) => [sk, flagRequestSeq.current[sk]]))

      applyPointFlagLocal(pointId, patch)
      flagInflight.current += 1
      setFlagSavingByPoint((prev) => {
        const next = { ...prev }
        for (const sk of seqKeys) next[sk] = true
        return next
      })

      const body = {
        cwd,
        pointId,
        expectedConfigVersion: packNow.configVersion || 1,
      }
      for (const k of keys) body[k] = patch[k] === true

      const isLatest = () => seqKeys.every((sk) => seqAtStart[sk] === flagRequestSeq.current[sk])

      const rollback = (msg) => {
        if (!isLatest()) return
        applyPointFlagLocal(pointId, {
          monitorEnabled: prevSnapshot.monitorEnabled,
          alarmEnabled: prevSnapshot.alarmEnabled,
          trendEnabled: prevSnapshot.trendEnabled,
        })
        if (msg) setError(msg)
      }

      const applySuccess = (data) => {
        if (!isLatest()) return data
        if (data.workspace?.modbus) {
          setWorkspace((prev) => {
            const next = { ...prev, modbus: data.workspace.modbus }
            workspaceRef.current = next
            return next
          })
        } else if (data.point?.id) {
          applyPointFlagLocal(pointId, {
            monitorEnabled: data.point.monitorEnabled === true,
            alarmEnabled: data.point.alarmEnabled === true,
            trendEnabled: data.point.monitorEnabled === true,
          })
          if (data.configVersion != null) {
            setWorkspace((prev) => {
              const next = { ...prev, modbus: { ...prev.modbus, configVersion: data.configVersion } }
              workspaceRef.current = next
              return next
            })
          }
        }
        setError('')
        return data
      }

      // 兼容未重启的旧 host：flags 路由 404/405 时回退整表 workspace 写入
      const fallbackWorkspacePersist = () => {
        const pack = normalizePack()
        const points = (pack.points || []).map((p) => {
          if (p.id !== pointId) return p
          const next = { ...p, ...patch }
          if (patch.monitorEnabled !== undefined) next.trendEnabled = patch.monitorEnabled === true
          return next
        })
        return post('/dsh-vision-bench/workspace', { cwd, modbus: { points, version: 3 } }).then((data) => {
          if (!isLatest()) return data
          if (!data || data.ok === false) {
            rollback(keys[0] === 'monitorEnabled' ? '监视状态保存失败，已恢复原状态' : '告警状态保存失败，已恢复原状态')
            return data
          }
          if (data.workspace?.modbus) {
            setWorkspace((prev) => {
              const next = { ...prev, modbus: data.workspace.modbus }
              workspaceRef.current = next
              return next
            })
            setError('')
          }
          return data
        })
      }

      return post('/dsh-vision-bench/points/flags', body)
        .then((data) => {
          if (!isLatest()) return data
          if (!data || data.ok === false) {
            const code = data?.errorCode
            if (code === 'CONFIG_DRIFT') {
              // 版本漂移：去掉 expected 重试一次（仍只改单点 flags）
              const retry = { cwd, pointId }
              for (const k of keys) retry[k] = patch[k] === true
              return post('/dsh-vision-bench/points/flags', retry)
                .then((data2) => {
                  if (!isLatest()) return data2
                  if (!data2 || data2.ok === false) {
                    rollback('点位配置已被其他操作更新，请重试')
                    return data2
                  }
                  return applySuccess(data2)
                })
                .catch(() =>
                  fallbackWorkspacePersist().catch(() => {
                    rollback('点位配置已被其他操作更新，请重试')
                  }),
                )
            }
            const tip =
              keys[0] === 'monitorEnabled' ? '监视状态保存失败，已恢复原状态' : '告警状态保存失败，已恢复原状态'
            rollback(tip)
            return data
          }
          return applySuccess(data)
        })
        .catch(() => {
          // host 未重启时常见 405/空响应 → 回退 workspace
          return fallbackWorkspacePersist().catch(() => {
            rollback(
              keys[0] === 'monitorEnabled'
                ? '监视状态保存失败，已恢复原状态（请完全重启 dsh web）'
                : '告警状态保存失败，已恢复原状态（请完全重启 dsh web）',
            )
          })
        })
        .finally(() => {
          flagInflight.current = Math.max(0, flagInflight.current - 1)
          setFlagSavingByPoint((prev) => {
            const next = { ...prev }
            for (const sk of seqKeys) {
              if (seqAtStart[sk] === flagRequestSeq.current[sk]) delete next[sk]
            }
            return next
          })
        })
    }

    function addNewPointRow(deviceId) {
      setError('')
      setInlineWrite(null)
      setEditingDeviceId('')
      setDeviceDraft(null)
      setBatch((prev) => ({ ...prev, open: false, deviceId: deviceId, connectionId: activeConnId }))
      setNewPointDraft({
        connectionId: activeConnId,
        deviceId,
        name: '',
        function: 3,
        address: 0,
        scale: 1,
        offset: 0,
        unit: '',
        monitorEnabled: true,
        alarmEnabled: false,
        alarmMin: '',
        alarmMax: '',
      })
    }

    function saveNewPointDraft() {
      const d = newPointDraft
      if (!d) return
      const pack = normalizePack()
      const fnNum = Math.trunc(Number(d.function) || 3)
      const addrNum = Math.trunc(Number(d.address))
      if (!Number.isFinite(addrNum) || addrNum < 0 || addrNum > 65535) {
        setError(t('ptAddr') + ' 0–65535')
        return
      }
      if ((d.alarmEnabled === true || d.alarmMin !== '' || d.alarmMax !== '') && !d.alarmEnabled) {
        /* 允许仅阈值但开关未开 → 视为未启用 */
      }
      const dup = (pack.points || []).some(
        (p) =>
          (p.connectionId || p.connId) === d.connectionId &&
          (p.deviceId || '') === d.deviceId &&
          p.function === fnNum &&
          p.address === addrNum,
      )
      if (dup) {
        setError('该设备下已存在相同功能码和地址的点位')
        return
      }
      const alarmOn = d.alarmEnabled === true
      const min = alarmOn && d.alarmMin !== '' ? Number(d.alarmMin) : null
      const max = alarmOn && d.alarmMax !== '' ? Number(d.alarmMax) : null
      if (alarmOn && min != null && max != null && !(min < max)) {
        setError('下限必须小于上限')
        return
      }
      const base = {
        id: hmiGenId('p'),
        connectionId: d.connectionId,
        connId: d.connectionId,
        deviceId: d.deviceId,
        name: String(d.name || '').slice(0, 40),
        function: fnNum,
        address: addrNum,
        scale: Number(d.scale) || 1,
        offset: Number(d.offset) || 0,
        unit: String(d.unit || '').slice(0, 12),
        monitorEnabled: d.monitorEnabled === true,
        alarmEnabled: alarmOn,
        alarmMin: Number.isFinite(min) ? min : null,
        alarmMax: Number.isFinite(max) ? max : null,
        trendEnabled: d.monitorEnabled === true,
        area: fnNum === 1 ? 'coil' : fnNum === 2 ? 'discreteInput' : fnNum === 4 ? 'inputRegister' : 'holdingRegister',
      }
      persist({ points: (pack.points || []).concat([base]), version: 3 })
      setNewPointDraft(null)
    }

    function saveDeviceEdit(d) {
      const pack = normalizePack()
      const meta = deviceDraft
      if (!meta) return
      const name = String(meta.name || '')
        .trim()
        .slice(0, 40)
      if (!name) {
        setError('请填写设备名称')
        return
      }
      const unitId = Math.trunc(Number(meta.unitId))
      if (!Number.isFinite(unitId) || unitId < 1 || unitId > 247) {
        setError('站号 1–247')
        return
      }
      if ((pack.devices || []).some((x) => x.connectionId === d.connectionId && x.id !== d.id && x.unitId === unitId)) {
        setError('该连接内站号 ' + unitId + ' 已存在')
        return
      }
      const nextDevices = (pack.devices || []).map((x) => (x.id === d.id ? { ...x, name, unitId } : x))
      persist({ devices: nextDevices, version: 3 })
      setEditingDeviceId('')
      setDeviceDraft(null)
    }

    function savePointsEdit(d) {
      const pack = normalizePack()
      const drafts = pointDraftsById || {}
      const keyOf = (p) => (p.connectionId || '') + '|' + (p.deviceId || '') + '|' + p.function + '|' + p.address
      const seen = new Map()
      for (const dOf of Object.values(drafts)) {
        if (seen.has(keyOf(dOf))) {
          setError('该设备下已存在相同功能码和地址的点位')
          return
        }
        seen.set(keyOf(dOf), dOf)
      }
      try {
        const nextPoints = (pack.points || []).map((p) => {
          const dr = drafts[p.id]
          if (!dr || (p.deviceId || '') !== d.id) return p
          const min = dr.alarmMin !== '' ? Number(dr.alarmMin) : null
          const max = dr.alarmMax !== '' ? Number(dr.alarmMax) : null
          if (p.alarmEnabled === true && min != null && max != null && !(min < max)) {
            throw new Error('下限必须小于上限: ' + (dr.name || p.name))
          }
          return {
            ...p,
            name: String(dr.name || '').slice(0, 40) || p.name,
            function: (() => {
              const fn = Math.trunc(Number(dr.function) || p.function)
              return [1, 2, 3, 4].includes(fn) ? fn : p.function
            })(),
            area: (() => {
              const fn = Math.trunc(Number(dr.function) || p.function)
              return AREA_BY_FN_EDIT[fn] || p.area
            })(),
            address: Math.trunc(Number(dr.address)),
            scale: Number(dr.scale) || 1,
            offset: Number(dr.offset) || 0,
            unit: String(dr.unit || '').slice(0, 12),
            alarmMin: Number.isFinite(min) ? min : null,
            alarmMax: Number.isFinite(max) ? max : null,
          }
        })
        persist({ points: nextPoints, version: 3 })
        setEditingPointsDeviceId('')
        setPointDraftsById({})
      } catch (err) {
        setError(String(err?.message || err))
      }
    }

    function cancelDeviceEdit() {
      setEditingDeviceId('')
      setDeviceDraft(null)
    }

    function cancelPointsEdit() {
      setEditingPointsDeviceId('')
      setPointDraftsById({})
      setNewPointDraft(null)
    }

    // ── csv ──
    function exportCsv(deviceId) {
      const pack = normalizePack()
      const did = deviceId || ''
      const filtered = (pack.points || []).filter((p) => (p.deviceId || '') === did)
      navigator.clipboard
        .writeText(pointsToCsv(filtered))
        .then(() => {
          setCsvNote(t('csvDone'))
          setTimeout(() => setCsvNote(''), 1500)
        })
        .catch(() => {
          /* clipboard unavailable */
        })
    }

    function importCsv() {
      const parsed = csvToPoints(csvText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      const pack = normalizePack()
      const fixedCid = pack.activeConnectionId || pack.connections[0]?.id || ''
      const fixedDid = csvTarget.deviceId
      if (!fixedDid) {
        setError('请先选择设备再导入 CSV')
        return
      }
      // Task1/0.19.3: CSV 只作用于当前设备；替换模式清空该设备点位与值
      const withConn = parsed.points.map((p) => ({
        ...p,
        id: p.id || hmiGenId('p'),
        connectionId: fixedCid,
        connId: fixedCid,
        deviceId: fixedDid,
        trendEnabled: p.trendEnabled === true,
        area:
          p.function === 1
            ? 'coil'
            : p.function === 2
              ? 'discreteInput'
              : p.function === 4
                ? 'inputRegister'
                : 'holdingRegister',
      }))
      setError('')
      setCsvTarget((prev) => ({ ...prev, open: false }))
      setCsvText('')
      const mode = csvTarget.mode === 'replace' ? 'replace' : 'merge'
      if (mode === 'replace') {
        // 替换：清空该设备点位与当前值，其余设备/连接保留
        const kept = (pack.points || []).filter(
          (p) => !((p.connectionId || p.connId) === fixedCid && (p.deviceId || '') === fixedDid),
        )
        const gone = new Set(
          (pack.points || [])
            .filter((p) => (p.connectionId || p.connId) === fixedCid && (p.deviceId || '') === fixedDid)
            .map((p) => p.id),
        )
        const keptValues = (pack.values || []).filter((v) => !gone.has(v.pointId || v.key))
        persist({ points: kept.concat(withConn), values: keptValues, version: 3 })
      } else {
        // 合并：仅追加/覆盖同设备同功能码同地址的点位
        const points = (pack.points || []).slice()
        for (const np of withConn) {
          const idx = points.findIndex(
            (p) =>
              (p.connectionId || p.connId) === fixedCid &&
              (p.deviceId || '') === fixedDid &&
              p.function === np.function &&
              p.address === np.address,
          )
          if (idx >= 0) points[idx] = { ...points[idx], ...np, id: points[idx].id }
          else points.push(np)
        }
        persist({ points, version: 3 })
      }
    }

    // ── derived ──
    const pack = normalizePack()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []
    const activeConnId = pack.activeConnectionId || connections[0]?.id || ''
    const activeDeviceId =
      pack.activeDeviceId || (devices || []).find((d) => d.connectionId === activeConnId)?.id || devices[0]?.id || ''
    const activeConnObj = connections.find((c) => c.id === activeConnId) || connections[0] || { conn: {} }
    const conn = activeConnObj?.conn || {}
    // 点位表按 activeConnId 过滤
    const allPoints = Array.isArray(pack.points) ? pack.points : []
    const points = allPoints.filter((p) => (p.connectionId || p.connId) === activeConnId)
    // 设备树：选中连接后列出该连接下 devices
    const activeDevices = devices.filter((d) => d.connectionId === activeConnId)
    const valuesArr = Array.isArray(pack.values) ? pack.values : []
    const valueMap = {}
    for (const item of valuesArr) {
      const k = item.key || item.pointId
      if (k) valueMap[k] = item
    }
    const alarmStateData = pack.alarmState && typeof pack.alarmState === 'object' ? pack.alarmState : {}
    const sim = conn.sim === true
    const canDevice = canUseModbus(ioRuntime, conn.mode, { simulated: sim })
    const ioStatus = ioRuntimeStatus(ioRuntime, conn.mode)
    const connMissing = !sim && (conn.mode === 'tcp' ? !conn.host : !conn.port)
    const pollingByConnection = pack.pollingByConnection || {}
    const polling = pollingByConnection[activeConnId] || { enabled: false, intervalMs: 1000 }
    const watchEnabled = !!polling.enabled

    function linkConnection(id) {
      if (!cwd || !id) return
      setLinkBusy(id)
      post('/dsh-vision-bench/connection/open', { cwd, connectionId: id }, 15000)
        .then((data) => {
          if (data && data.ok === false) setError(data.error || t('fail'))
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          if (data && Array.isArray(data.connectionStates)) setConnectionStates(data.connectionStates)
        })
        .catch((err) => setError(String(err?.message || t('fail'))))
        .finally(() => setLinkBusy(''))
    }
    function unlinkConnection(id) {
      if (!cwd || !id) return
      setLinkBusy(id)
      post('/dsh-vision-bench/connection/close', { cwd, connectionId: id }, 15000)
        .then(() => post('/dsh-vision-bench/state', { cwd }))
        .then((data) => {
          if (data && Array.isArray(data.connectionStates)) setConnectionStates(data.connectionStates)
        })
        .catch(() => {})
        .finally(() => setLinkBusy(''))
    }

    function toggleSim() {
      const next = !sim
      // persist 按 connId 定向，toggleSim 按 activeConnId
      setActiveConnPatch({ sim: next })
    }

    // Task2/0.19.3: 采集由 Host 后台服务运行；UI 只负责 开始/停止
    function toggleCollection() {
      if (!cwd || !activeConnId) return
      setLinkBusy('poll')
      const url = watchEnabled ? '/dsh-vision-bench/polling/stop' : '/dsh-vision-bench/polling/start'
      post(url, { cwd, connectionId: activeConnId }, 15000)
        .then(() => post('/dsh-vision-bench/state', { cwd }))
        .then((data) => {
          if (data?.workspace?.modbus) {
            setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
          }
        })
        .catch((err) => setError(String(err?.message || t('fail'))))
        .finally(() => setLinkBusy(''))
    }

    function setPollingInterval(ms) {
      const nextPolling = {
        ...(pollingByConnection || {}),
        [activeConnId]: { ...polling, enabled: true, intervalMs: Number(ms) || 1000 },
      }
      persist({ pollingByConnection: nextPolling, version: 3 })
      post('/dsh-vision-bench/polling/start', {
        cwd,
        connectionId: activeConnId,
        intervalMs: Number(ms) || 1000,
      }).catch(() => {})
    }

    function findRtuOccupier(port, excludeId) {
      return rtuOccupierAmong(connections, port, excludeId)
    }
    function findTcpOccupier(host, tcpPort, excludeId) {
      return tcpOccupierAmong(connections, host, tcpPort, excludeId)
    }

    const focusToast = renderFocusToast(el, t, { focusState, returnToPrevFocus, setFocusUi })

    const connListPanel = renderConnectionPanel(el, t, {
      focusState,
      connections,
      cwd,
      addConnection,
      activeConnObj,
      sim,
      activeConnId,
      toggleSim,
      watchEnabled,
      linkBusy,
      points,
      toggleCollection,
      polling,
      setPollingInterval,
      canDevice,
      connectionStates,
      selectConnection,
      findRtuOccupier,
      linkConnection,
      unlinkConnection,
      openConnEdit,
      sendToAgent,
      pendingDeleteId,
      setPendingDeleteId,
      requestDeleteConnection,
    })
    const connFormPanel = renderConnectionForm(el, t, {
      connForm,
      setConnForm,
      connectionStates,
      field,
      scanning,
      ports,
      findRtuOccupier,
      findTcpOccupier,
      scanPorts,
      cwd,
      saveConnEdit,
    })

    const devFormPanel = renderDeviceForm(el, t, {
      field,
      devForm,
      setDevForm,
      activeConnId,
      activeConnObj,
      cwd,
      saveDeviceForm,
    })

    const pointsOfDevice = (devId) =>
      allPoints.filter((p) => (p.connectionId || p.connId) === activeConnId && (p.deviceId || '') === devId)
    const readRunning = runningOf(journal, 'read')
    const writeRunning = runningOf(journal, 'write')

    const pointRowCtx = {
      valueMap,
      focusState,
      editingPointsDeviceId,
      pointDraftsById,
      inlineWrite,
      setInlineWrite,
      submitWriteCell,
      openWriteCell,
      busy,
      writeRunning,
      patchDraft,
      sendToAgent,
      flagSavingByPoint,
      persistPointFlags,
      removePointRow,
    }

    const deviceCardsPanel = renderDeviceCards(el, t, {
      activeConnObj,
      activeDevices,
      points,
      cwd,
      activeConnId,
      openAddDevice,
      pointsOfDevice,
      busy,
      devDeleteId,
      setDevDeleteId,
      editingDeviceId,
      editingPointsDeviceId,
      newPointDraft,
      setNewPointDraft,
      batch,
      setBatch,
      csvTarget,
      setCsvTarget,
      csvNote,
      connectionStates,
      valueMap,
      alarmStateData,
      focusState,
      deviceDraft,
      setDeviceDraft,
      saveDeviceEdit,
      cancelDeviceEdit,
      requestDeleteDevice,
      enterDeviceEdit,
      savePointsEdit,
      cancelPointsEdit,
      addNewPointRow,
      canDevice,
      connMissing,
      readRunning,
      readAll,
      enterPointsEdit,
      exportCsv,
      sendToAgent,
      confirmDeleteDevice,
      field,
      generateBatch,
      importCsv,
      csvText,
      setCsvText,
      saveNewPointDraft,
      pointRowCtx,
    })

    const pendingPanel = renderPendingPanel(el, t, { pending, resolveWrite })

    function resolveDraft(id, action) {
      if (!cwd) return
      setDraftBusy(id + ':' + action)
      setDraftNote('')
      const url = action === 'apply' ? '/dsh-vision-bench/config/draft/apply' : '/dsh-vision-bench/config/draft'
      const body = action === 'apply' ? { cwd, draftId: id } : { cwd, op: 'discard', draftId: id, id }
      post(url, body, 20000)
        .then((data) => {
          if (data && data.ok === false) {
            const code = data.errorCode || ''
            setDraftNote((code === 'CONFIG_DRIFT' ? t('configDrift') + ': ' : '') + (data.error || t('fail')))
            setError((code === 'CONFIG_DRIFT' ? t('configDrift') + ': ' : '') + (data.error || ''))
          } else {
            setDraftNote(action === 'apply' ? t('draftApplied') : t('draftDiscarded'))
            setTimeout(() => setDraftNote(''), 1800)
          }
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          if (!data) return
          setJournal(pickJournal(data))
          if (data.workspace) {
            setWorkspace((prev) => ({
              ...prev,
              modbus: data.workspace.modbus || prev.modbus,
              configDrafts: data.workspace.configDrafts || prev.configDrafts,
            }))
            workspaceRef.current = {
              ...workspaceRef.current,
              modbus: data.workspace.modbus || workspaceRef.current.modbus,
              configDrafts: data.workspace.configDrafts || workspaceRef.current.configDrafts,
            }
          }
        })
        .catch((err) => {
          setDraftNote(String(err?.message || t('fail')))
          setError(String(err?.message || t('fail')))
        })
        .finally(() => setDraftBusy(''))
    }
    const draftPanel = renderDraftPanel(el, t, { workspace, normalizePack, draftBusy, draftNote, cwd, resolveDraft })

    function resolveWrite(id, approved) {
      post('/dsh-vision-bench/modbus/write/approve', { cwd, id, approved }, 120000)
        .then((data) => {
          setPending((prev) => prev.filter((item) => item.id !== id))
          if (data && data.ok === false && !data.rejected) setError(data.error || t('fail'))
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          if (!data) return
          setJournal(pickJournal(data))
          if (data.workspace?.modbus) {
            setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
          }
        })
        .catch((err) => {
          setError(String(err?.message || t('fail')))
        })
    }

    const tabBar = renderConnectionTabs(el, t, {
      pack,
      pending,
      journal,
      activeConnId,
      connections,
      hmiTab,
      setHmiTab,
      moreOpen,
      setMoreOpen,
      selectConnection,
      findRtuOccupier,
      findTcpOccupier,
      cwd,
      addConnection,
    })

    // 全部连接视图：仅管理表
    if (hmiTab === 'all') {
      return el(
        'div',
        { className: 'dvb-page' },
        statusBar(el, t, cwd, [
          { key: 'io', kind: ioStatus.kind, text: t('ioRuntimeShort') + ' · ' + t(ioStatus.labelKey) },
        ]),
        visionCollabBar(el, t, { cwd, workspace, journal, pendingWrites: pending, sessionId }),
        error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
        agentCopied
          ? el(
              'div',
              { className: 'dvb-msg', 'data-kind': 'ok' },
              agentCopied.split(':').pop() + ' · ' + agentCopied.split(':').slice(0, 2).join(':'),
            )
          : null,
        tabBar,
        focusToast,
        connListPanel,
        connFormPanel,
        draftPanel,
      )
    }

    return el(
      'div',
      { className: 'dvb-page' },
      statusBar(el, t, cwd, [
        { key: 'io', kind: ioStatus.kind, text: t('ioRuntimeShort') + ' · ' + t(ioStatus.labelKey) },
      ]),
      visionCollabBar(el, t, { cwd, workspace, journal, pendingWrites: pending, sessionId }),
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      agentCopied
        ? el(
            'div',
            { className: 'dvb-msg', 'data-kind': 'ok' },
            agentCopied.split(':').pop() + ' · ' + agentCopied.split(':').slice(0, 2).join(':'),
          )
        : null,
      tabBar,
      focusToast,
      // 连接总览卡片仅在「全部连接」；单连接 tab 只看设备/点位
      devFormPanel,
      deviceCardsPanel,
      pendingPanel,
      draftPanel,
    )
  }
}
