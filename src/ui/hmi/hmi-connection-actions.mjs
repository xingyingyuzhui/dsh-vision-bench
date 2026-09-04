import { clearFramesLog } from '../../../bench-shared.mjs'
import { hmiGenId } from './hmi-ids.mjs'

/** Connection and device lifecycle actions for the HMI page. */
export function createHmiConnectionActions(ctx, core) {
  const {
    cwd,
    post,
    setError,
    setFrameFilter,
    setDevForm,
    devForm,
    connForm,
    setConnForm,
    setHmiTab,
    setMoreOpen,
    pendingDeleteId,
    setPendingDeleteId,
    lastDeviceByConn,
  } = ctx
  const setBatch = ctx.setBatch || (() => {})
  const setNewPointDraft = ctx.setNewPointDraft || (() => {})
  const setCsvTarget = ctx.setCsvTarget || (() => {})
  const setEditingDeviceId = ctx.setEditingDeviceId || (() => {})
  const setEditingPointsDeviceId = ctx.setEditingPointsDeviceId || (() => {})
  const setInlineWrite = ctx.setInlineWrite || (() => {})
  const setDevDeleteId = ctx.setDevDeleteId || (() => {})
  const { normalizePack, persist, activeConnIdOf } = core

  function deviceBelongsTo(deviceId, connectionId) {
    if (!deviceId) return false
    const pack = normalizePack()
    return (pack.devices || []).some((device) => device.id === deviceId && device.connectionId === connectionId)
  }

  function dismissEditorsExcept(connectionId) {
    setConnForm((prev) => (!prev.open || prev.id === connectionId ? prev : { ...prev, open: false }))
    setDevForm((prev) => (!prev.open || prev.connectionId === connectionId ? prev : { ...prev, open: false }))
    setBatch((prev) => (prev.open && !deviceBelongsTo(prev.deviceId, connectionId) ? { ...prev, open: false } : prev))
    setNewPointDraft((prev) => (prev && !deviceBelongsTo(prev.deviceId, connectionId) ? null : prev))
    setCsvTarget((prev) =>
      prev.open && !deviceBelongsTo(prev.deviceId, connectionId) ? { ...prev, open: false } : prev,
    )
    setEditingDeviceId((id) => (deviceBelongsTo(id, connectionId) ? id : ''))
    setEditingPointsDeviceId((id) => (deviceBelongsTo(id, connectionId) ? id : ''))
    setInlineWrite(null)
    setDevDeleteId('')
  }

  function addConnection() {
    const pack = normalizePack()
    const id = hmiGenId('c')
    const connection = {
      id,
      name: `连接${pack.connections.length + 1}`,
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
    persist({
      connections: [...(pack.connections || []), connection],
      devices: pack.devices || [],
      pollingByConnection: {
        ...(pack.pollingByConnection || {}),
        [id]: { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' },
      },
      framesByConnection: { ...(pack.framesByConnection || {}), [id]: [] },
      activeConnectionId: id,
      activeDeviceId: '',
      version: 3,
    })
    setHmiTab(id)
    lastDeviceByConn.current[id] = ''
    setFrameFilter(id)
    dismissEditorsExcept(id)
    setDevForm({ open: true, id: '', name: '', unitId: 1, connectionId: id })
  }

  function openAddDevice() {
    setError('')
    const pack = normalizePack()
    const connectionId = activeConnIdOf()
    const devices = (pack.devices || []).filter((device) => device.connectionId === connectionId)
    setDevForm({
      open: true,
      id: '',
      name: '',
      unitId: devices.length ? Math.max(...devices.map((device) => device.unitId || 1)) + 1 : 1,
      connectionId,
    })
  }

  function openEditDevice(device) {
    setError('')
    setDevForm({
      open: true,
      id: device.id,
      name: device.name,
      unitId: device.unitId,
      connectionId: device.connectionId,
    })
  }

  function saveDeviceForm() {
    const pack = normalizePack()
    const connectionId = devForm.connectionId || activeConnIdOf()
    if (!connectionId || (devForm.connectionId && devForm.connectionId !== activeConnIdOf())) {
      return setError('当前连接已切换，请重新打开添加设备')
    }
    const name = String(devForm.name || '')
      .trim()
      .slice(0, 40)
    if (!name) return setError('请填写设备名称')
    const unitId = Math.trunc(Number(devForm.unitId))
    if (!Number.isFinite(unitId) || unitId < 1 || unitId > 247) return setError('站号 1–247')
    if (
      (pack.devices || []).some(
        (device) => device.connectionId === connectionId && device.id !== devForm.id && device.unitId === unitId,
      )
    ) {
      return setError(`该连接内站号 ${unitId} 已存在`)
    }
    if (devForm.id) {
      persist({
        devices: (pack.devices || []).map((device) =>
          device.id === devForm.id ? { ...device, name, unitId } : device,
        ),
        version: 3,
      })
    } else {
      const id = hmiGenId('d')
      persist({
        devices: [...(pack.devices || []), { id, connectionId, name, unitId, enabled: true }],
        activeDeviceId: id,
        version: 3,
      })
      lastDeviceByConn.current[connectionId] = id
    }
    setDevForm((previous) => ({ ...previous, open: false }))
  }

  function requestDeleteDevice(device) {
    const pack = normalizePack()
    const connectionId = activeConnIdOf()
    const points = (pack.points || []).filter(
      (point) => point.deviceId === device.id && (point.connectionId || point.connId) === connectionId,
    )
    const pointIds = new Set(points.map((point) => point.id))
    const valueCount = (pack.values || []).filter((value) => pointIds.has(value.pointId || value.key)).length
    setDevDeleteId(`${device.id}|${points.length}|${valueCount}`)
  }

  function confirmDeleteDevice(device) {
    const pack = normalizePack()
    const connectionId = activeConnIdOf()
    const removedPointIds = new Set(
      (pack.points || [])
        .filter((point) => point.deviceId === device.id && (point.connectionId || point.connId) === connectionId)
        .map((point) => point.id),
    )
    const devices = (pack.devices || []).filter((candidate) => candidate.id !== device.id)
    persist({
      devices,
      points: (pack.points || []).filter((point) => !removedPointIds.has(point.id)),
      values: (pack.values || []).filter((value) => !removedPointIds.has(value.pointId || value.key)),
      activeDeviceId: devices.some(
        (candidate) => candidate.id === pack.activeDeviceId && candidate.connectionId === connectionId,
      )
        ? pack.activeDeviceId
        : devices.find((candidate) => candidate.connectionId === connectionId)?.id || '',
      version: 3,
    })
    setDevDeleteId('')
  }

  function selectConnection(connectionId) {
    const pack = normalizePack()
    let deviceId = lastDeviceByConn.current[connectionId]
    if (
      !deviceId ||
      !(pack.devices || []).some((device) => device.id === deviceId && device.connectionId === connectionId)
    ) {
      deviceId = (pack.devices || []).find((device) => device.connectionId === connectionId)?.id || ''
    }
    persist({ activeConnectionId: connectionId, activeDeviceId: deviceId, version: 3 })
    setPendingDeleteId('')
    setHmiTab(connectionId)
    setMoreOpen(false)
    setFrameFilter(connectionId)
    dismissEditorsExcept(connectionId)
  }

  function requestDeleteConnection(connectionId) {
    if (pendingDeleteId !== connectionId) return setPendingDeleteId(connectionId)
    const pack = normalizePack()
    if ((pack.connections || []).length <= 1) {
      setError('至少保留一个连接')
      return setPendingDeleteId('')
    }
    const connections = (pack.connections || []).filter((connection) => connection.id !== connectionId)
    const devices = (pack.devices || []).filter((device) => device.connectionId !== connectionId)
    const points = (pack.points || []).filter((point) => (point.connectionId || point.connId) !== connectionId)
    const pointIds = new Set(points.map((point) => point.id))
    const pollingByConnection = { ...(pack.pollingByConnection || {}) }
    const framesByConnection = { ...(pack.framesByConnection || {}) }
    delete pollingByConnection[connectionId]
    delete framesByConnection[connectionId]
    let activeConnectionId = pack.activeConnectionId
    let activeDeviceId = pack.activeDeviceId
    if (activeConnectionId === connectionId) {
      activeConnectionId = connections[0]?.id || ''
      activeDeviceId = devices.find((device) => device.connectionId === activeConnectionId)?.id || ''
      setFrameFilter(activeConnectionId || 'all')
      setHmiTab(activeConnectionId || 'all')
    }
    clearFramesLog(cwd, connectionId)
    setPendingDeleteId('')
    persist({
      connections,
      devices,
      points,
      values: (pack.values || []).filter((value) => pointIds.has(value.key || value.pointId)),
      pollingByConnection,
      framesByConnection,
      activeConnectionId,
      activeDeviceId,
      version: 3,
    })
  }

  function openConnEdit(connection) {
    const pack = normalizePack()
    const pollCfg = pack.pollingByConnection?.[connection.id] || {}
    setConnForm({
      open: true,
      id: connection.id,
      name: connection.name,
      role: connection.role,
      enabled: connection.enabled !== false,
      conn: { ...(connection.conn || {}) },
      intervalMs: Number(pollCfg.intervalMs) || 1000,
    })
  }

  function saveConnEdit() {
    const pack = normalizePack()
    const connections = (pack.connections || []).map((connection) =>
      connection.id === connForm.id
        ? {
            ...connection,
            name: connForm.name.slice(0, 40),
            role: connForm.role === 'server' || connForm.role === 'slave' ? 'server' : 'client',
            enabled: true,
            conn: {
              ...(connection.conn || {}),
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
        : connection,
    )
    const isServer = connForm.role === 'server' || connForm.role === 'slave'
    const intervalMs = Math.max(200, Number(connForm.intervalMs) || 1000)
    const existingPoll = pack.pollingByConnection?.[connForm.id] || {}
    const pollingByConnection = {
      ...(pack.pollingByConnection || {}),
      [connForm.id]: {
        ...existingPoll,
        enabled: isServer ? false : existingPoll.enabled,
        intervalMs,
      },
    }
    setConnForm((previous) => ({ ...previous, open: false }))
    persist({ connections, pollingByConnection, version: 3 })
    if (isServer && existingPoll.enabled && post && cwd) {
      post('/dsh-vision-bench/polling/stop', { cwd, connectionId: connForm.id }, 15000).catch(() => {})
    } else if (!isServer && existingPoll.enabled && post && cwd) {
      post('/dsh-vision-bench/polling/start', { cwd, connectionId: connForm.id, intervalMs }, 15000).catch(() => {})
    }
  }

  function setActiveConnPatch(patch) {
    const pack = normalizePack()
    const connectionId = pack.activeConnectionId
    if (!connectionId) return
    const nextPatch = { ...(patch || {}), slave: undefined }
    persist({
      connections: (pack.connections || []).map((connection) =>
        connection.id === connectionId
          ? { ...connection, conn: { ...(connection.conn || {}), ...nextPatch } }
          : connection,
      ),
      version: 3,
    })
  }

  function updateActiveConnMeta(patch) {
    const pack = normalizePack()
    persist({
      connections: (pack.connections || []).map((connection) =>
        connection.id === pack.activeConnectionId ? { ...connection, ...patch } : connection,
      ),
      version: 3,
    })
  }

  return {
    addConnection,
    openAddDevice,
    openEditDevice,
    saveDeviceForm,
    requestDeleteDevice,
    confirmDeleteDevice,
    selectConnection,
    requestDeleteConnection,
    openConnEdit,
    saveConnEdit,
    setActiveConnPatch,
    updateActiveConnMeta,
  }
}
