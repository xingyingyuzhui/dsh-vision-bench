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
import { persistHmiPatch } from './hmi-config-persistence.mjs'

/** Shared state, persistence, Agent-focus and derived-view helpers for the HMI page. */
export function createHmiCoreActions(ctx) {
  const {
    t,
    post,
    cwd,
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

  function persist(modbusPatch) {
    if (!cwd) return Promise.resolve()
    const currentPack = normalizePack()
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
    return persistHmiPatch(commandClient, currentPack, modbusPatch)
      .then((data) => {
        if (seq === inflight.current && data?.workspace?.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus }))
          workspaceRef.current = { ...workspaceRef.current, modbus: data.workspace.modbus }
        }
        if (data) setJournal(pickJournal(data))
        if (data?.ok === false) {
          setError(data.error || t('fail'))
          return commandClient.refresh().then((fresh) => {
            if (seq === inflight.current && fresh?.workspace?.modbus) {
              setWorkspace((prev) => ({ ...prev, modbus: fresh.workspace.modbus }))
              workspaceRef.current = { ...workspaceRef.current, modbus: fresh.workspace.modbus }
            }
          })
        }
        return data
      })
      .catch((error) => setError(String(error?.message || t('fail'))))
      .finally(() => {
        if (seq === inflight.current) inflight.current = 0
      })
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
    const activeDeviceId =
      pack.activeDeviceId || devices.find((device) => device.connectionId === activeConnId)?.id || devices[0]?.id || ''
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
