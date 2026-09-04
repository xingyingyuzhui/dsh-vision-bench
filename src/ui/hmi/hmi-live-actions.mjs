import { encodeValue, normalizeWriteValues } from '../../../bench-points.mjs'
import { formatErrorMessage, pickJournal, pushFramesLog } from '../../../bench-shared.mjs'
import { rtuOccupierAmong, tcpOccupierAmong } from './hmi-controller.mjs'

/** Live read/write, connection link, and polling actions. */
export function createHmiLiveActions(ctx, core) {
  const {
    t,
    post,
    cwd,
    sessionId,
    setBusy,
    setError,
    setWorkspace,
    setJournal,
    setConnectionStates,
    workspaceRef,
    setNewPointDraft,
    inlineWrite,
    setInlineWrite,
    setLinkBusy,
  } = ctx
  const { normalizePack, persist, derived } = core

  async function refreshConnectionState() {
    if (!cwd) return
    const data = await post('/dsh-vision-bench/state', { cwd })
    if (Array.isArray(data?.connectionStates)) setConnectionStates(data.connectionStates)
    if (data?.workspace?.modbus) {
      setWorkspace((prev) => {
        const nextModbus = { ...prev.modbus, ...data.workspace.modbus }
        const next = { ...prev, modbus: nextModbus }
        workspaceRef.current = { ...workspaceRef.current, modbus: nextModbus }
        return next
      })
    }
    if (data) setJournal(pickJournal(data))
    return data
  }

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
        pushFramesLog(cwd, activeConnId, data.framesLog || data.frames || [])
        if (Array.isArray(data.values)) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
          workspaceRef.current = {
            ...workspaceRef.current,
            modbus: { ...workspaceRef.current.modbus, values: data.values },
          }
        }
        if (data.ok === false && data.error) setError(formatErrorMessage(data.error))
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

  function openWriteCell(point) {
    setError('')
    setNewPointDraft(null)
    const pack = normalizePack()
    const rec = (pack.values || []).find((item) => (item.key || item.pointId) === point.id)
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

  function linkConnection(id) {
    if (!cwd || !id) return Promise.resolve()
    setLinkBusy(id)
    setError('')
    return post('/dsh-vision-bench/connection/open', { cwd, connectionId: id }, 15000)
      .then(async (data) => {
        if (data && data.ok === false) setError(formatErrorMessage(data.error) || t('fail'))
        const pack = normalizePack()
        const conn = (pack.connections || []).find((c) => c.id === id)
        const isServer = conn?.role === 'server' || conn?.role === 'slave'
        if (!isServer) {
          const pollingCfg = pack.pollingByConnection?.[id] || {}
          const intervalMs = pollingCfg.intervalMs || 1000
          await post('/dsh-vision-bench/polling/start', { cwd, connectionId: id, intervalMs }, 15000).catch(() => {})
        }
        try {
          await refreshConnectionState()
        } catch (error) {
          setError(String(error?.message || t('fail')))
        }
      })
      .catch(async (err) => {
        setError(String(err?.message || t('fail')))
        try {
          await refreshConnectionState()
        } catch (refreshError) {
          void refreshError
        }
      })
      .finally(() => setLinkBusy(''))
  }

  function unlinkConnection(id) {
    if (!cwd || !id) return Promise.resolve()
    setLinkBusy(id)
    setError('')
    post('/dsh-vision-bench/polling/stop', { cwd, connectionId: id }, 15000).catch(() => {})
    return post('/dsh-vision-bench/connection/close', { cwd, connectionId: id }, 15000)
      .then(async (data) => {
        if (data && data.ok === false) setError(formatErrorMessage(data.error) || t('fail'))
        try {
          await refreshConnectionState()
        } catch (error) {
          setError(String(error?.message || t('fail')))
        }
      })
      .catch(async (err) => {
        setError(String(err?.message || t('fail')))
        try {
          await refreshConnectionState()
        } catch (refreshError) {
          void refreshError
        }
      })
      .finally(() => setLinkBusy(''))
  }

  function toggleSim() {
    const pack = normalizePack()
    const connectionId = pack.activeConnectionId
    if (!connectionId) return
    persist({
      connections: (pack.connections || []).map((connection) =>
        connection.id === connectionId
          ? { ...connection, conn: { ...(connection.conn || {}), sim: !derived().sim, slave: undefined } }
          : connection,
      ),
      version: 3,
    })
  }

  function toggleCollection() {
    const d = derived()
    if (!cwd || !d.activeConnId) return Promise.resolve()
    setLinkBusy('poll')
    setError('')
    const url = d.watchEnabled ? '/dsh-vision-bench/polling/stop' : '/dsh-vision-bench/polling/start'
    return post(url, { cwd, connectionId: d.activeConnId }, 15000)
      .then(async (data) => {
        if (data?.ok === false) setError(formatErrorMessage(data.error) || t('fail'))
        try {
          await refreshConnectionState()
        } catch (error) {
          setError(String(error?.message || t('fail')))
        }
      })
      .catch(async (err) => {
        setError(String(err?.message || t('fail')))
        try {
          await refreshConnectionState()
        } catch (refreshError) {
          void refreshError
        }
      })
      .finally(() => setLinkBusy(''))
  }

  function setPollingInterval(ms) {
    const d = derived()
    if (!cwd || !d.activeConnId) return Promise.resolve()
    setLinkBusy('poll')
    setError('')
    return post(
      '/dsh-vision-bench/polling/start',
      {
        cwd,
        connectionId: d.activeConnId,
        intervalMs: Number(ms) || 1000,
      },
      15000,
    )
      .then(async (data) => {
        if (data?.ok === false) setError(formatErrorMessage(data.error) || t('fail'))
        try {
          await refreshConnectionState()
        } catch (error) {
          setError(String(error?.message || t('fail')))
        }
      })
      .catch(async (err) => {
        setError(String(err?.message || t('fail')))
        try {
          await refreshConnectionState()
        } catch (refreshError) {
          void refreshError
        }
      })
      .finally(() => setLinkBusy(''))
  }

  function findRtuOccupier(port, excludeId) {
    return rtuOccupierAmong(derived().connections, port, excludeId)
  }

  function findTcpOccupier(host, tcpPort, excludeId) {
    return tcpOccupierAmong(derived().connections, host, tcpPort, excludeId)
  }

  return {
    readAll,
    readOne,
    openWriteCell,
    submitWriteCell,
    linkConnection,
    unlinkConnection,
    toggleSim,
    toggleCollection,
    setPollingInterval,
    findRtuOccupier,
    findTcpOccupier,
  }
}
