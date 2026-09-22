// @ts-check
import { notifyBenchEvent } from '../../infrastructure/host/notify.mjs'

export const WATCH_TTL_MS = 30 * 60 * 1000
const LEDGER_TTL_MS = 60 * 60 * 1000
const LEDGER_MAX = 4000
export const MAX_DELIVERY_ATTEMPTS = 3

/**
 * @type {Map<string, {
 *   followup: boolean,
 *   sessionId: string,
 *   pointIds: Set<string>,
 *   connectionId: string,
 *   testRunId: string,
 *   createdAt: number,
 *   expiresAt: number,
 * }>}
 */
export const agentAlarmWatchByKey = new Map()

/**
 * @type {Map<string, { state: 'pending' | 'delivered', attempts: number, at: number }>}
 */
export const deliveryLedger = new Map()

/** @type {() => number} */
let nowMs = () => Date.now()

/** @type {null | ((home: any, cwd: string, summary: string, detail?: string, opts?: any) => Promise<any>)} */
let notifyFn = null

/**
 * @param {{ clock?: () => number, notify?: typeof notifyBenchEvent | null }} [hooks]
 */
export function setAlarmNotifyTestHooks(hooks = {}) {
  if (typeof hooks.clock === 'function') nowMs = hooks.clock
  if (hooks.notify === null) notifyFn = null
  else if (typeof hooks.notify === 'function') notifyFn = hooks.notify
}

export function resetAlarmNotifyTestHooks() {
  nowMs = () => Date.now()
  notifyFn = null
}

export function clockNow() {
  return nowMs()
}

/**
 * @param {any} home
 * @param {string} cwd
 * @param {string} summary
 * @param {string} detail
 * @param {any} opts
 */
export async function deliverNotify(home, cwd, summary, detail, opts) {
  const fn = notifyFn || notifyBenchEvent
  return fn(home, cwd, summary, detail, opts)
}

/**
 * @param {string} cwd
 * @param {string} sessionId
 */
export function watchKey(cwd, sessionId) {
  return `${String(cwd || '')}::${String(sessionId || '')}`
}

/**
 * @param {string} cwd
 */
export function pruneExpiredWatches(cwd) {
  const now = nowMs()
  const prefix = `${String(cwd || '')}::`
  for (const [key, watch] of agentAlarmWatchByKey) {
    if (cwd && !key.startsWith(prefix) && key !== watchKey(cwd, watch.sessionId)) continue
    if (Number(watch.expiresAt) > 0 && Number(watch.expiresAt) <= now) {
      agentAlarmWatchByKey.delete(key)
    }
  }
}

export function pruneDeliveryLedger() {
  const now = nowMs()
  for (const [id, entry] of deliveryLedger) {
    if (now - Number(entry.at || 0) > LEDGER_TTL_MS) deliveryLedger.delete(id)
  }
  while (deliveryLedger.size > LEDGER_MAX) {
    const first = deliveryLedger.keys().next().value
    if (first == null) break
    deliveryLedger.delete(first)
  }
}

/**
 * @param {string} cwd
 * @param {{
 *   followup?: boolean,
 *   sessionId?: string,
 *   pointIds?: string[],
 *   connectionId?: string,
 *   testRunId?: string,
 *   ttlMs?: number,
 *   expiresAt?: number,
 *   createdAt?: number,
 * }} [spec]
 */
export function setAgentAlarmWatch(cwd, spec = {}) {
  const keyCwd = String(cwd || '')
  if (!keyCwd) return null
  const sessionId = typeof spec.sessionId === 'string' ? spec.sessionId : ''
  const now = nowMs()
  const ttl = Number(spec.ttlMs)
  const expiresAt =
    Number(spec.expiresAt) > 0
      ? Number(spec.expiresAt)
      : now + (Number.isFinite(ttl) && ttl > 0 ? Math.trunc(ttl) : WATCH_TTL_MS)
  const createdAt = Number(spec.createdAt) > 0 ? Number(spec.createdAt) : now
  const entry = {
    followup: spec.followup !== false,
    sessionId,
    pointIds: new Set(Array.isArray(spec.pointIds) ? spec.pointIds.filter(Boolean).map(String) : []),
    connectionId: typeof spec.connectionId === 'string' ? spec.connectionId : '',
    testRunId: typeof spec.testRunId === 'string' ? spec.testRunId : '',
    createdAt,
    expiresAt,
  }
  agentAlarmWatchByKey.set(watchKey(keyCwd, sessionId), entry)
  return {
    sessionId: entry.sessionId,
    connectionId: entry.connectionId,
    pointIds: [...entry.pointIds],
    followup: entry.followup,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  }
}

/**
 * @param {string} cwd
 * @param {string} [sessionId]
 */
export function clearAgentAlarmWatch(cwd, sessionId) {
  const keyCwd = String(cwd || '')
  if (!keyCwd) return
  if (typeof sessionId === 'string') {
    agentAlarmWatchByKey.delete(watchKey(keyCwd, sessionId))
    return
  }
  const prefix = `${keyCwd}::`
  for (const key of [...agentAlarmWatchByKey.keys()]) {
    if (key.startsWith(prefix)) agentAlarmWatchByKey.delete(key)
  }
}

/**
 * @param {string} cwd
 * @param {string} [sessionId]
 */
export function getAgentAlarmWatch(cwd, sessionId) {
  pruneExpiredWatches(cwd)
  if (typeof sessionId === 'string') {
    return agentAlarmWatchByKey.get(watchKey(cwd, sessionId)) || null
  }
  const prefix = `${String(cwd || '')}::`
  for (const [key, watch] of agentAlarmWatchByKey) {
    if (key.startsWith(prefix)) return watch
  }
  return null
}

/**
 * @param {string} eventId
 */
export function beginDeliveryAttempt(eventId) {
  pruneDeliveryLedger()
  const id = String(eventId || '')
  if (!id) return { proceed: true, entry: null }
  const existing = deliveryLedger.get(id)
  if (existing?.state === 'delivered') return { proceed: false, entry: existing }
  if (existing && existing.attempts >= MAX_DELIVERY_ATTEMPTS) return { proceed: false, entry: existing }
  const entry = {
    state: /** @type {'pending'} */ ('pending'),
    attempts: (existing?.attempts || 0) + 1,
    at: nowMs(),
  }
  deliveryLedger.set(id, entry)
  return { proceed: true, entry }
}

/**
 * @param {string} eventId
 */
export function markDelivered(eventId) {
  const id = String(eventId || '')
  if (!id) return
  const prev = deliveryLedger.get(id)
  deliveryLedger.set(id, {
    state: 'delivered',
    attempts: prev?.attempts || 1,
    at: nowMs(),
  })
}
