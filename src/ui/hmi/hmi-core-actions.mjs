import { normalizeModbus } from '../../../bench-devices.mjs'
import { canUseModbus, ioRuntimeStatus } from '../../../bench-io-capability.mjs'
import {
  buildAgentRef,
  dispatchAgentRef,
  emptyWorkspace,
  evidenceFromRef,
  hasHarnessInput,
  pickJournal,
  postEvidence,
  setTempWatch,
} from '../../../bench-shared.mjs'
import { restoreUserLocation } from '../workspace/vision-navigation-store.mjs'
import { persistHmiPatch } from './hmi-config-persistence.mjs'

function snapshotModbusPack(pack) {
  return JSON.parse(
    JSON.stringify({
      version: pack.version,
      configVersion: pack.configVersion,
      connections: pack.connections || [],
      devices: pack.devices || [],
      points: pack.points || [],
      values: pack.values || [],
      activeConnectionId: pack.activeConnectionId || '',
      activeDeviceId: pack.activeDeviceId || '',
      pollingByConnection: pack.pollingByConnection || {},
      framesByConnection: pack.framesByConnection || {},
      alarmState: pack.alarmState || {},
      trend: pack.trend || {},
      visualization: pack.visualization || {},
    }),
  )
}

/** Shared state, persistence, Agent-focus and derived-view helpers for the HMI page. */
export function createHmiCoreActions(ctx) {
  const {
    t,
    post,
    cwd,
    sessionId,
    props,
    agentBridge,
    commandClient,
    setError,
    setPorts,
    setScanning,
    ioRuntime,
    setWorkspace,
    setJournal,
    workspaceRef,
    inflight,
    focusState,
    agentCopied,
    setAgentCopied,
    setTempWatchNote,
  } = ctx

  function normalizePack() {
    const mb = workspaceRef.current.modbus || emptyWorkspace().modbus
    try {
      return normalizeModbus(mb)
    } catch {
      if (mb && (mb.version === 2 || mb.version === 3)) return mb
      return emptyWorkspace().modbus
    }
  }

  function activeConnIdOf() {
    const pack = normalizePack()
    return pack.activeConnectionId || (pack.connections || [])[0]?.id || ''
  }

  function scanPorts() {
    setScanning(true)
    post('/dsh-vision-bench/serial/ports', {}, 30000)
      .then((data) => setPorts(data && Array.isArray(data.ports) ? data.ports : []))
      .catch(() => setPorts([]))
      .finally(() => setScanning(false))
  }

  async function restoreWorkspaceAfterFailure(seq, fallbackPack, message) {
    setError(message)
    if (seq !== inflight.current) return
    try {
      const fresh = await commandClient.refresh()
      if (seq !== inflight.current) return
      const hostPack = fresh?.workspace?.modbus
      if (hostPack) {
        setWorkspace((prev) => {
          const next = { ...prev, modbus: hostPack }
          workspaceRef.current = next
          return next
        })
        setJournal(pickJournal(fresh))
        return
      }
    } catch {
      // Host refresh failed; fall through to the pre-mutation snapshot.
    }
    if (seq !== inflight.current) return
    setWorkspace((prev) => {
      const next = { ...prev, modbus: fallbackPack }
      workspaceRef.current = next
      return next
    })
    setError('配置保存失败，当前状态可能已过期')
  }

  async function persist(modbusPatch) {
    if (!cwd) return
    const currentPack = normalizePack()
    const fallbackPack = snapshotModbusPack(currentPack)
    const seq = ++inflight.current
    setWorkspace((prev) => {
      const next = { ...prev, modbus: { ...prev.modbus } }
      for (const key of Object.keys(modbusPatch)) {
        if (key === 'conn' || key === 'polling') {
          next.modbus[key] = { ...(next.modbus[key] || {}), ...modbusPatch[key] }
        } else {
          next.modbus[key] = modbusPatch[key]
        }
      }
      workspaceRef.current = next
      return next
    })
    try {
      const data = await persistHmiPatch(commandClient, currentPack, modbusPatch)
      if (seq !== inflight.current) return data
      if (!data || data.ok === false) {
        await restoreWorkspaceAfterFailure(seq, fallbackPack, data?.error || t('fail'))
        return data
      }
      if (data.workspace?.modbus) {
        const currentVersion = Number(workspaceRef.current?.modbus?.configVersion || 0)
        const hostVersion = Number(data.workspace.modbus.configVersion || 0)
        if (hostVersion >= currentVersion) {
          setWorkspace((prev) => {
            const next = { ...prev, modbus: data.workspace.modbus }
            workspaceRef.current = next
            return next
          })
        }
      }
      setJournal(pickJournal(data))
      return data
    } catch (error) {
      await restoreWorkspaceAfterFailure(seq, fallbackPack, String(error?.message || t('fail')))
    } finally {
      if (seq === inflight.current) inflight.current = 0
    }
  }

  function cfgVersion() {
    return normalizePack().configVersion || 1
  }

  function agentRefFor(kind, payload) {
    return buildAgentRef(kind, payload, { configVersion: cfgVersion() })
  }

  function sendToAgent(kind, payload) {
    const ref = agentRefFor(kind, payload)
    Promise.resolve(dispatchAgentRef(ref, agentBridge))
      .then((res) => {
        const key = `${kind}:${payload?.id || payload?.pointId || payload?.frameId || payload?.connectionId || payload?.deviceId || ''}`
        const status = res?.ok ? res.status || res.mode : '处理失败'
        setAgentCopied(`${key}:${res?.mode || 'failed'}:${status}`)
        setTimeout(() => setAgentCopied(''), 2500)
      })
      .catch(() => {})
    try {
      postEvidence(post, cwd, evidenceFromRef(ref), (reason) => setError(reason))
    } catch {}
    return ref
  }

  function agentBtnLabel(kind, payload) {
    const copied = String(agentCopied || '')
    const key = `${kind}:${payload?.id || payload?.pointId || payload?.frameId || payload?.connectionId || ''}`
    if (copied.startsWith(`${key}:`)) {
      return (
        copied
          .slice(key.length + 1)
          .split(':')
          .slice(1)
          .join(':') || '仅复制'
      )
    }
    return hasHarnessInput(props) ? '让 Agent 分析' : '复制给 Agent'
  }

  function requestFocusUi(target, options) {
    if (!cwd) return
    post(
      '/dsh-vision-bench/focus',
      {
        cwd,
        sessionId: sessionId || '',
        target: target || {},
        tempWatchIds: options?.tempWatchIds || [],
        evidence: options?.evidence || [],
        badgeOnly: !!options?.badgeOnly,
        foreground: !options?.badgeOnly,
      },
      15000,
    ).catch((error) => setError(String(error?.message || t('fail'))))
  }

  function returnToPrevFocus() {
    restoreUserLocation(sessionId || '', cwd)
    if (focusState?.prev) requestFocusUi(focusState.prev, { badgeOnly: false })
  }

  function createTempWatch(ids) {
    const list = setTempWatch(cwd, ids, 300000)
    setTempWatchNote(`临时监视组已创建：${list.length} 点`)
    setTimeout(() => setTempWatchNote(''), 2000)
    requestFocusUi(focusState.request || {}, { tempWatchIds: list, badgeOnly: true })
  }

  function derived() {
    const pack = normalizePack()
    const connections = Array.isArray(pack.connections) ? pack.connections : []
    const devices = Array.isArray(pack.devices) ? pack.devices : []
    const activeConnId = pack.activeConnectionId || connections[0]?.id || ''
    const belonging = devices.find(
      (device) => device.id === pack.activeDeviceId && device.connectionId === activeConnId,
    )
    const activeDeviceId = belonging?.id || devices.find((device) => device.connectionId === activeConnId)?.id || ''
    const activeConnObj = connections.find((connection) => connection.id === activeConnId) ||
      connections[0] || { conn: {} }
    const conn = activeConnObj.conn || {}
    const allPoints = Array.isArray(pack.points) ? pack.points : []
    const points = allPoints.filter((point) => (point.connectionId || point.connId) === activeConnId)
    const activeDevices = devices.filter((device) => device.connectionId === activeConnId)
    const valueMap = {}
    for (const item of Array.isArray(pack.values) ? pack.values : []) {
      const key = item.key || item.pointId
      if (key) valueMap[key] = item
    }
    const alarmStateData = pack.alarmState && typeof pack.alarmState === 'object' ? pack.alarmState : {}
    const sim = conn.sim === true
    const pollingByConnection = pack.pollingByConnection || {}
    const polling = pollingByConnection[activeConnId] || { enabled: false, intervalMs: 1000 }
    return {
      pack,
      connections,
      devices,
      activeConnId,
      activeDeviceId,
      activeConnObj,
      conn,
      allPoints,
      points,
      activeDevices,
      valueMap,
      alarmStateData,
      sim,
      canDevice: canUseModbus(ioRuntime, conn.mode, { simulated: sim }),
      ioStatus: ioRuntimeStatus(ioRuntime, conn.mode),
      connMissing: !sim && (conn.mode === 'tcp' ? !conn.host : !conn.port),
      pollingByConnection,
      polling,
      watchEnabled: !!polling.enabled,
    }
  }

  return {
    activeConnIdOf,
    scanPorts,
    normalizePack,
    persist,
    cfgVersion,
    agentRefFor,
    sendToAgent,
    agentBtnLabel,
    requestFocusUi,
    returnToPrevFocus,
    createTempWatch,
    derived,
  }
}
