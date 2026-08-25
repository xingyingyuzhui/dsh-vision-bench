// Task2/0.19.3: Host-managed background collection service.
//
// One Polling Coordinator per workspace. Each connection keeps its own cycle
// (interval + in-flight guard + queue) so curves/alarms/frames keep receiving
// data even when no sidebar page is open. The plugin unload path stops every
// timer and in-flight request.
import { modbusPoll } from './bench-modbus.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { loadWorkspace, saveWorkspace } from './bench-store.mjs'

const coordinators = new Map() // cwd -> coordinator
let stopping = false

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

const clearConnectionTimer = (co, cid) => {
  const entry = co.timers.get(cid)
  if (!entry) return
  if (entry.timer) clearInterval(entry.timer)
  co.timers.delete(cid)
}

// one tick: run ONE budgeted poll pass for this connection; never overlap
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
const reconcile = (home, cwd, packIn) => {
  const co = coordinatorFor(cwd)
  const pack = packIn || normalizeModbus(loadWorkspace(home, cwd).modbus || {})
  const wanted = new Map()
  for (const c of pack.connections || []) {
    const p = (pack.pollingByConnection || {})[c.id]
    if (p && p.enabled === true && (c.conn && !c.conn.sim)) {
      wanted.set(c.id, { intervalMs: Number(p.intervalMs) || 1000 })
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
    const entry = { timer: 0, intervalMs: cfg.intervalMs, busy: false }
    co.timers.set(cid, entry)
    entry.timer = setInterval(() => {
      void tickConnection(home, cwd, cid, entry)
    }, Math.max(200, Number(cfg.intervalMs) || 1000))
    if (entry.timer.unref) entry.timer.unref()
    // kick off immediately
    void tickConnection(home, cwd, cid, entry)
  }
  return co
}

const persistEnable = (home, cwd, connectionId, enabled, intervalMs) => {
  const ws = loadWorkspace(home, cwd)
  const pack = normalizeModbus(ws.modbus || {})
  const cid = connectionId || pack.activeConnectionId || (pack.connections[0] && pack.connections[0].id)
  if (!cid) return { ok: false, error: '无连接可采集' }
  const nextPolling = { ...(pack.pollingByConnection || {}) }
  const cur = nextPolling[cid] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
  nextPolling[cid] = {
    ...cur,
    enabled: enabled === true,
    intervalMs: Number.isFinite(Number(intervalMs)) && Number(intervalMs) >= 200 && Number(intervalMs) <= 10000 ? Math.trunc(Number(intervalMs)) : cur.intervalMs,
  }
  saveWorkspace(home, cwd, { modbus: { pollingByConnection: nextPolling, version: 3 } })
  return { ok: true, connectionId: cid, enabled: nextPolling[cid].enabled, intervalMs: nextPolling[cid].intervalMs }
}

export const startPolling = async (home, cwd, opts = {}) => {
  const saved = persistEnable(home, cwd, opts.connectionId || opts.connId, true, opts.intervalMs)
  if (!saved.ok) return saved
  reconcile(home, cwd)
  return { ...saved, action: 'polling/start', running: true }
}

export const stopPolling = async (home, cwd, opts = {}) => {
  const saved = persistEnable(home, cwd, opts.connectionId || opts.connId, false)
  if (!saved.ok) return saved
  const co = coordinators.get(String(cwd))
  if (co) {
    if (saved.connectionId) clearConnectionTimer(co, saved.connectionId)
    else for (const cid of [...co.timers.keys()]) clearConnectionTimer(co, cid)
  }
  return { ...saved, action: 'polling/stop', running: false }
}

export const pollingStatus = (home, cwd) => {
  const pack = normalizeModbus(loadWorkspace(home, cwd).modbus || {})
  const co = coordinators.get(String(cwd))
  const byConnection = {}
  for (const c of pack.connections || []) {
    const p = (pack.pollingByConnection || {})[c.id] || { enabled: false, intervalMs: 1000, lastAt: 0, lastOk: true, error: '' }
    const active = co ? co.timers.has(c.id) : false
    byConnection[c.id] = { enabled: p.enabled === true, intervalMs: p.intervalMs, lastAt: p.lastAt || 0, lastOk: p.lastOk !== false, error: p.error || '', running: active }
  }
  return { ok: true, action: 'polling/status', active: !!(co && co.timers.size), connections: byConnection }
}

// ensure timers for whatever the workspace currently marks enabled (called on /state)
export const ensurePolling = (home, cwd) => {
  if (stopping) return
  const pack = normalizeModbus(loadWorkspace(home, cwd).modbus || {})
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