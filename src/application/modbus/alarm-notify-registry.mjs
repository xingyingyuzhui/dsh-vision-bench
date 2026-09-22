// @ts-check
import { randomUUID } from 'node:crypto'
import { notifyBenchEvent } from '../../infrastructure/host/notify.mjs'

export const WATCH_TTL_MS = 30 * 60 * 1000
const LEDGER_TTL_MS = 60 * 60 * 1000
const LEDGER_MAX = 4000
/** 3 total deliveries: first attempt + 2 retries (delays 1s / 3s). */
export const MAX_DELIVERY_ATTEMPTS = 3

/** Monotonic runtime epoch. Dispose invalidates the current token before cleanup. */
let runtimeEpoch = 0
let runtimeActive = true

/** @returns {number} */
export function captureAlarmRuntimeToken() {
  return runtimeEpoch
}

/** @param {number} token */
export function isAlarmRuntimeCurrent(token) {
  return runtimeActive && Number(token) === runtimeEpoch
}

/** Host lease start: allow deliveries again and bump the epoch. */
export function startAlarmNotifyRuntime() {
  runtimeActive = true
  runtimeEpoch += 1
  return runtimeEpoch
}

/** Invalidate the current epoch FIRST so in-flight promises cannot resurrect state. */
export function invalidateAlarmNotifyRuntime() {
  runtimeActive = false
  runtimeEpoch += 1
}

/**
 * Delivery ledger entry states.
 * pending  — a claim is in-flight; a second claim must not proceed.
 * queued   — failed once and waiting for bounded retry.
 * delivered— successfully notified this recipient.
 * exhausted— retry budget used up without success.
 * @typedef {'pending' | 'queued' | 'delivered' | 'exhausted'} DeliveryState
 */

/**
 * @type {Map<string, {
 *   followup: boolean,
 *   sessionId: string,
 *   pointIds: Set<string>,
 *   connectionId: string,
 *   testRunId: string,
 *   subscriptionId: string,
 *   createdAt: number,
 *   expiresAt: number,
 * }>}
 */
export const agentAlarmWatchByKey = new Map()

/**
 * Keyed by eventId + sessionId so multi-session fan-out is independent.
 * @type {Map<string, { state: DeliveryState, attempts: number, at: number }>}
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
 * @param {string} eventId
 * @param {string} sessionId
 */
export function deliveryKey(eventId, sessionId) {
  return `${String(eventId || '')}::${String(sessionId || '')}`
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
 * @param {Iterable<string> | undefined} ids
 * @returns {string[]}
 */
export function normalizePointIdList(ids) {
  return [...new Set((Array.isArray(ids) ? ids : []).filter(Boolean).map(String))].sort()
}

/**
 * @param {{ connectionId?: string, pointIds?: Set<string> | string[] }} a
 * @param {{ connectionId?: string, pointIds?: Set<string> | string[] }} b
 */
function watchTargetsEqual(a, b) {
  const ap = normalizePointIdList(a.pointIds instanceof Set ? [...a.pointIds] : a.pointIds)
  const bp = normalizePointIdList(b.pointIds instanceof Set ? [...b.pointIds] : b.pointIds)
  return String(a.connectionId || '') === String(b.connectionId || '') && ap.join(',') === bp.join(',')
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
  const pointIds = new Set(normalizePointIdList(spec.pointIds))
  const connectionId = typeof spec.connectionId === 'string' ? spec.connectionId : ''
  const prev = agentAlarmWatchByKey.get(watchKey(keyCwd, sessionId))
  // Pure renewal of the same target set keeps identity; any target change mints a new id.
  const keepIdentity =
    !!prev && prev.followup !== false && spec.followup !== false && watchTargetsEqual(prev, { connectionId, pointIds })
  const subscriptionId = keepIdentity ? prev.subscriptionId : randomUUID()
  const entry = {
    followup: spec.followup !== false,
    sessionId,
    pointIds,
    connectionId,
    testRunId: typeof spec.testRunId === 'string' ? spec.testRunId : '',
    subscriptionId,
    createdAt,
    expiresAt,
  }
  agentAlarmWatchByKey.set(watchKey(keyCwd, sessionId), entry)
  return {
    sessionId: entry.sessionId,
    connectionId: entry.connectionId,
    pointIds: [...entry.pointIds],
    followup: entry.followup,
    subscriptionId: entry.subscriptionId,
    createdAt: entry.createdAt,
    expiresAt: entry.expiresAt,
  }
}

/**
 * Clear ONE session's watch. Callers that mean "unsubscribe this session" must
 * pass a non-empty sessionId — never fall through to clear-all.
 * @param {string} cwd
 * @param {string} [sessionId] omit only for dispose/tests that wipe a cwd
 */
export function clearAgentAlarmWatch(cwd, sessionId) {
  const keyCwd = String(cwd || '')
  if (!keyCwd) return
  if (typeof sessionId === 'string' && sessionId) {
    agentAlarmWatchByKey.delete(watchKey(keyCwd, sessionId))
    return
  }
  if (typeof sessionId === 'string' && !sessionId) return
  const prefix = `${keyCwd}::`
  for (const key of [...agentAlarmWatchByKey.keys()]) {
    if (key.startsWith(prefix)) agentAlarmWatchByKey.delete(key)
  }
}

/**
 * @param {string} cwd
 * @param {string} sessionId
 */
export function revokeAgentAlarmSubscription(cwd, sessionId) {
  const sid = String(sessionId || '')
  if (!sid) return null
  const key = watchKey(cwd, sid)
  const prev = agentAlarmWatchByKey.get(key) || null
  agentAlarmWatchByKey.delete(key)
  return prev
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
 * Claim one recipient delivery slot. A second claim while pending returns
 * proceed:false so concurrent emit paths cannot double-deliver.
 *
 * @param {string} eventId
 * @param {string} sessionId
 * @returns {{ proceed: boolean, entry: { state: DeliveryState, attempts: number, at: number } | null }}
 */
export function beginDeliveryAttempt(eventId, sessionId) {
  pruneDeliveryLedger()
  const id = String(eventId || '')
  const sid = String(sessionId || '')
  if (!id) return { proceed: true, entry: null }
  const key = deliveryKey(id, sid)
  const existing = deliveryLedger.get(key)
  if (existing?.state === 'delivered') return { proceed: false, entry: existing }
  if (existing?.state === 'exhausted') return { proceed: false, entry: existing }
  if (existing?.state === 'pending') return { proceed: false, entry: existing }
  if (existing?.state === 'queued') {
    // Retry path re-claims the same slot.
    if (existing.attempts >= MAX_DELIVERY_ATTEMPTS) {
      deliveryLedger.set(key, { state: 'exhausted', attempts: existing.attempts, at: nowMs() })
      return { proceed: false, entry: deliveryLedger.get(key) || null }
    }
    const entry = {
      state: /** @type {'pending'} */ ('pending'),
      attempts: existing.attempts + 1,
      at: nowMs(),
    }
    deliveryLedger.set(key, entry)
    return { proceed: true, entry }
  }
  const entry = {
    state: /** @type {'pending'} */ ('pending'),
    attempts: (existing?.attempts || 0) + 1,
    at: nowMs(),
  }
  deliveryLedger.set(key, entry)
  return { proceed: true, entry }
}

/**
 * @param {string} eventId
 * @param {string} sessionId
 */
export function markDelivered(eventId, sessionId) {
  const key = deliveryKey(eventId, sessionId)
  if (!String(eventId || '')) return
  const prev = deliveryLedger.get(key)
  deliveryLedger.set(key, {
    state: 'delivered',
    attempts: prev?.attempts || 1,
    at: nowMs(),
  })
}

/**
 * @param {string} eventId
 * @param {string} sessionId
 */
export function markQueued(eventId, sessionId) {
  const key = deliveryKey(eventId, sessionId)
  if (!String(eventId || '')) return
  const prev = deliveryLedger.get(key)
  deliveryLedger.set(key, {
    state: 'queued',
    attempts: prev?.attempts || 1,
    at: nowMs(),
  })
}

/**
 * @param {string} eventId
 * @param {string} sessionId
 */
export function markExhausted(eventId, sessionId) {
  const key = deliveryKey(eventId, sessionId)
  if (!String(eventId || '')) return
  const prev = deliveryLedger.get(key)
  deliveryLedger.set(key, {
    state: 'exhausted',
    attempts: prev?.attempts || MAX_DELIVERY_ATTEMPTS,
    at: nowMs(),
  })
}

/**
 * @param {string} eventId
 * @param {string} sessionId
 */
export function getDeliveryEntry(eventId, sessionId) {
  return deliveryLedger.get(deliveryKey(eventId, sessionId)) || null
}

/** Process-wide dispose: watches + ledger. Retry timers are cleared by the retry module. */
export function clearAlarmNotifyRegistryRuntime() {
  agentAlarmWatchByKey.clear()
  deliveryLedger.clear()
}
