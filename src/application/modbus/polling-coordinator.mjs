// @ts-check
import { normalizeModbus } from '../../domain/modbus/modbus-migration.mjs'
// Task2/0.19.3: Host-managed background collection service.
//
// One Polling Coordinator per workspace. Each connection keeps its own cycle
// (interval + in-flight guard + queue) so curves/alarms/frames keep receiving
// data even when no sidebar page is open. The plugin unload path stops every
// timer and in-flight request.
import { modbusPoll } from './polling-service.mjs'
import { getSimConnectionState, setSimConnectionState } from '../../infrastructure/modbus/serial-monitor.mjs'
import { loadWorkspace, workspaceRepository } from '../../infrastructure/store/workspace-store.mjs'
import { normalizeSessionConfigs, unionScopedConnections } from '../../domain/modbus/config-scope.mjs'

/** @type {Map<string, any>} */
const coordinators = new Map() // cwd -> coordinator
let stopping = false

/** @param {any} [cwd] @returns {any} */
const coordinatorFor = (cwd) => {
  let co = coordinators.get(String(cwd))
  if (!co) {
    co = {
      cwd: String(cwd),
      timers: new Map(), // cid -> { timer, intervalMs, busy }
      startedAt: Date.now(),
    }
    coordinators.set(String(cwd), co)
  }
  return co
}

/** @param {any} [co] @param {any} [cid] @returns {any} */
const clearConnectionTimer = (co, cid) => {
  const entry = co.timers.get(cid)
  if (!entry) return
  if (entry.timer) clearInterval(entry.timer)
  co.timers.delete(cid)
}

// one tick: run ONE budgeted poll pass for this connection; never overlap
/** @param {any} [home] @param {any} [cwd] @param {any} [cid] @param {any} [entry] @returns {Promise<any>} */
const tickConnection = async (home, cwd, cid, entry) => {
  if (entry.busy || stopping) return
  entry.busy = true
  try {
    const intervalMs = Math.max(200, Number(entry.intervalMs) || 1000)
    const ran = await modbusPoll(home, cwd, {
      connectionId: cid,
      source: 'polling',
      budgetMs: Math.max(150, Math.trunc(intervalMs * 0.8)),
    })
    // surface errors without spamming: keep lastOk/error on the workspace row
    void ran
  } catch {
    // next tick retries; worker-level errors cannot escape into the host
  } finally {
    entry.busy = false
  }
}

// reconcile: read the workspace and (re)schedule timers for enabled connections
/** @param {any} [home] @param {any} [cwd] @param {any} [packIn] @returns {any} */
const reconcile = (home, cwd, packIn) => {
  const co = coordinatorFor(cwd)
  const ws = loadWorkspace(home, cwd)
  const rawModbus = ws.modbus || {}
  const sc = normalizeSessionConfigs(rawModbus.sessionConfigs)
  const allConnections = unionScopedConnections(rawModbus.connections, sc, rawModbus.share)
  const pack = packIn || normalizeModbus(rawModbus)
  const connList = allConnections.length ? allConnections : pack.connections || []
  const wanted = new Map()
  for (const c of connList) {
    const p = (pack.pollingByConnection || {})[c.id]
    const isSim = Boolean(c.conn?.sim || c.sim)
    // Sim and RTU both require an explicit 开始采集. Auto-starting sim
    // polling used to fsync runtime.json every second with no UI action.
    const shouldPoll = c.enabled !== false && p && p.enabled === true
    if (shouldPoll && (c.conn || isSim)) {
      wanted.set(c.id, { intervalMs: Number(p?.intervalMs) || 1000 })
    }
  }
  // stop removed / disabled connections
  for (const cid of [...co.timers.keys()]) {
    if (!wanted.has(cid)) clearConnectionTimer(co, cid)
  }
  // (re)start changed connections
  for (const [cid, cfg] of wanted.entries()) {
    const existing = co.timers.get(cid)
    if (existing && Number(existing.intervalMs) === Number(cfg.intervalMs)) continue
    clearConnectionTimer(co, cid)
    const entry = /** @type {{ timer: any, intervalMs: any, busy: boolean }} */ ({
      timer: 0,
      intervalMs: cfg.intervalMs,
      busy: false,
    })
    co.timers.set(cid, entry)
    entry.timer = setInterval(
      () => {
        void tickConnection(home, cwd, cid, entry)
      },
      Math.max(200, Number(cfg.intervalMs) || 1000),
    )
    if (entry.timer.unref) entry.timer.unref()
    // kick off immediately
    void tickConnection(home, cwd, cid, entry)
  }
  return co
}

/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [connectionId]
 * @param {any} [enabled]
 * @param {any} [intervalMs]
 * @returns {Promise<any>}
 */
const persistEnable = async (home, cwd, connectionId, enabled, intervalMs) => {
  const ws = loadWorkspace(home, cwd)
  const pack = normalizeModbus(ws.modbus || {})
  const cid = connectionId || pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id)
  if (!cid) return { ok: false, error: '无连接可采集' }
  const saved = await workspaceRepository(home).mutateRuntime(cwd, (/** @type {any} */ current) => {
    const curPack = normalizeModbus(current.modbus || {})
    const nextPolling = { ...(curPack.pollingByConnection || {}) }
    const cur = nextPolling[cid] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
    const interval =
      Number.isFinite(Number(intervalMs)) && Number(intervalMs) >= 200 && Number(intervalMs) <= 10000
        ? Math.trunc(Number(intervalMs))
        : cur.intervalMs
    nextPolling[cid] = { ...cur, enabled: enabled === true, intervalMs: interval }
    return { workspace: { ...current, modbus: { ...current.modbus, pollingByConnection: nextPolling, version: 3 } } }
  })
  if (!saved.ok) return saved
  const next = saved.workspace.modbus.pollingByConnection[cid]
  return { ok: true, connectionId: cid, enabled: next.enabled, intervalMs: next.intervalMs }
}

export const resetPollingService = () => {
  stopping = false
}

/** @param {any} [home] @param {any} [cwd] @param {any} [opts] @returns {Promise<any>} */
export const startPolling = async (home, cwd, opts = /** @type {any} */ ({})) => {
  stopping = false
  const cid = opts.connectionId || opts.connId
  if (cid) setSimConnectionState(cwd, cid, 'connected')
  const saved = await persistEnable(home, cwd, cid, true, opts.intervalMs)
  if (!saved.ok) return saved
  reconcile(home, cwd)
  return { ...saved, action: 'polling/start', running: true }
}

/** @param {any} [home] @param {any} [cwd] @param {any} [opts] @returns {Promise<any>} */
export const stopPolling = async (home, cwd, opts = /** @type {any} */ ({})) => {
  const cid = opts.connectionId || opts.connId
  if (cid) setSimConnectionState(cwd, cid, 'disconnected')
  const saved = await persistEnable(home, cwd, cid, false)
  if (!saved.ok) return saved
  const co = coordinators.get(String(cwd))
  if (co) {
    if (saved.connectionId) clearConnectionTimer(co, saved.connectionId)
    else for (const id of [...co.timers.keys()]) clearConnectionTimer(co, id)
  }
  return { ...saved, action: 'polling/stop', running: false }
}

/** @param {any} [home] @param {any} [cwd] @returns {any} */
export const pollingStatus = (home, cwd) => {
  const pack = normalizeModbus(loadWorkspace(home, cwd).modbus || {})
  const co = coordinators.get(String(cwd))
  /** @type {Record<string, any>} */
  const byConnection = {}
  for (const c of pack.connections || []) {
    const p = (pack.pollingByConnection || {})[c.id] || {
      enabled: false,
      intervalMs: 1000,
      lastAt: 0,
      lastOk: true,
      error: '',
    }
    const active = co ? co.timers.has(c.id) : false
    byConnection[c.id] = {
      enabled: p.enabled === true,
      intervalMs: p.intervalMs,
      lastAt: p.lastAt || 0,
      lastOk: p.lastOk !== false,
      error: p.error || '',
      running: active,
    }
  }
  return { ok: true, action: 'polling/status', active: !!(co && co.timers.size), connections: byConnection }
}

// ensure timers for whatever the workspace currently marks enabled (called on /state)
/** @param {any} [home] @param {any} [cwd] @returns {any} */
export const ensurePolling = (home, cwd) => {
  if (stopping) return
  const ws = loadWorkspace(home, cwd)
  const rawModbus = ws.modbus || {}
  const sc = normalizeSessionConfigs(rawModbus.sessionConfigs)
  const allConnections = unionScopedConnections(rawModbus.connections, sc, rawModbus.share)
  const pack = normalizeModbus(rawModbus)
  for (const c of allConnections) {
    if (c.conn?.sim || c.sim) {
      const p = (pack.pollingByConnection || {})[c.id]
      if (c.enabled !== false && p && p.enabled === true) {
        setSimConnectionState(cwd, c.id, 'connected')
      } else {
        setSimConnectionState(cwd, c.id, 'disconnected')
      }
    }
  }
  reconcile(home, cwd, pack)
}

// plugin unload: stop EVERY timer and mark the service stopped
export const stopAllPolling = () => {
  stopping = true
  for (const co of coordinators.values()) {
    for (const cid of [...co.timers.keys()]) clearConnectionTimer(co, cid)
  }
  coordinators.clear()
}

export const pollingHealth = () => ({ coordinators: coordinators.size, stopping })
