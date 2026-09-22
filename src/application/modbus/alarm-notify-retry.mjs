// @ts-check
/**
 * Bounded in-memory retry queue for failed alarm followups.
 * Total deliveries: 3 (first + 2 retries). Retry delays: 1s, 3s.
 * Process restart drops the queue (documented); dispose invalidates the
 * runtime epoch first so in-flight promises cannot resurrect tasks.
 */
import {
  MAX_DELIVERY_ATTEMPTS,
  beginDeliveryAttempt,
  captureAlarmRuntimeToken,
  deliverNotify,
  isAlarmRuntimeCurrent,
  markDelivered,
  markExhausted,
  markQueued,
} from './alarm-notify-registry.mjs'
import { recipientStillAuthorized } from './alarm-notify-match.mjs'

/** Retry delays after the first failed attempt. */
export const RETRY_DELAYS_MS = [1_000, 3_000]

/**
 * @typedef {'queued' | 'pending' | 'delivered' | 'exhausted' | 'cancelled'} NotifyRetryState
 *
 * @typedef {{
 *   eventId: string,
 *   sessionId: string,
 *   home: any,
 *   cwd: string,
 *   summary: string,
 *   detail: string,
 *   opts: any,
 *   attempts: number,
 *   enqueuedAt: number,
 *   dueAt: number,
 *   timer: any,
 *   recipient: any,
 *   item: any,
 *   sourceSessionId?: string,
 *   runtimeEpoch: number,
 *   cancelled: boolean,
 *   state: NotifyRetryState,
 *   guards: { recheck: (home: any, cwd: string, item: any, sessionId?: string) => any },
 * }} NotifyRetryTask
 */

/** @type {Map<string, NotifyRetryTask>} */
const retryByKey = new Map()

/** @type {() => number} */
let nowFn = () => Date.now()
/** @type {(fn: () => void, ms: number) => any} */
let setTimer = (fn, ms) => setTimeout(fn, ms)
/** @type {(handle: any) => void} */
let clearTimer = (handle) => clearTimeout(handle)

/** @type {null | ((payload: { eventId: string, sessionId: string, attempts: number, ok: boolean }) => void)} */
let onRetryOutcome = null

/**
 * @param {{
 *   clock?: () => number,
 *   setTimer?: (fn: () => void, ms: number) => any,
 *   clearTimer?: (handle: any) => void,
 *   onRetryOutcome?: ((payload: { eventId: string, sessionId: string, attempts: number, ok: boolean }) => void) | null,
 * }} [hooks]
 */
export function setAlarmNotifyRetryTestHooks(hooks = {}) {
  if (typeof hooks.clock === 'function') nowFn = hooks.clock
  if (typeof hooks.setTimer === 'function') setTimer = hooks.setTimer
  if (typeof hooks.clearTimer === 'function') clearTimer = hooks.clearTimer
  if ('onRetryOutcome' in hooks) onRetryOutcome = hooks.onRetryOutcome || null
}

export function resetAlarmNotifyRetryTestHooks() {
  nowFn = () => Date.now()
  setTimer = (fn, ms) => setTimeout(fn, ms)
  clearTimer = (handle) => clearTimeout(handle)
  onRetryOutcome = null
}

/**
 * @param {string} eventId
 * @param {string} sessionId
 */
function retryKey(eventId, sessionId) {
  return `${String(eventId || '')}::${String(sessionId || '')}`
}

/**
 * @param {NotifyRetryTask} task
 * @param {any} item
 */
function guardsPass(task, item) {
  if (task.cancelled) return false
  if (!isAlarmRuntimeCurrent(task.runtimeEpoch)) return false
  if (!recipientStillAuthorized(task.home, task.cwd, item, task.recipient)) return false
  if (!task.guards || typeof task.guards.recheck !== 'function') return true
  try {
    const live = task.guards.recheck(task.home, task.cwd, item, task.sessionId)
    return !!(live && live.current)
  } catch {
    return false
  }
}

/**
 * Unified execute entry used by timers and manual due-run. Cancels the
 * corresponding timer first so concurrent triggers execute once.
 * @param {NotifyRetryTask} task
 */
async function runRetryTask(task) {
  const key = retryKey(task.eventId, task.sessionId)
  if (task.timer) {
    clearTimer(task.timer)
    task.timer = null
  }
  if (task.cancelled || task.state === 'delivered' || task.state === 'exhausted' || task.state === 'cancelled') {
    return
  }
  const token = captureAlarmRuntimeToken()
  if (!isAlarmRuntimeCurrent(token) || !isAlarmRuntimeCurrent(task.runtimeEpoch)) return

  const item = task.item
  if (!guardsPass(task, item)) {
    if (!isAlarmRuntimeCurrent(token) || task.cancelled) return
    task.state = 'exhausted'
    markExhausted(task.eventId, task.sessionId)
    if (retryByKey.get(key) === task) retryByKey.delete(key)
    onRetryOutcome?.({ eventId: task.eventId, sessionId: task.sessionId, attempts: task.attempts, ok: false })
    return
  }

  const attempt = beginDeliveryAttempt(task.eventId, task.sessionId)
  if (!attempt.proceed) {
    if (attempt.entry?.state === 'delivered' || attempt.entry?.state === 'exhausted') {
      task.state = attempt.entry.state === 'delivered' ? 'delivered' : 'exhausted'
      if (retryByKey.get(key) === task) retryByKey.delete(key)
    }
    return
  }

  task.state = 'pending'
  let delivered
  try {
    delivered = await deliverNotify(task.home, task.cwd, task.summary, task.detail, task.opts)
  } catch {
    delivered = { ok: false }
  }
  if (!isAlarmRuntimeCurrent(token) || task.cancelled) return

  if (delivered && delivered.ok === true) {
    task.state = 'delivered'
    markDelivered(task.eventId, task.sessionId)
    if (retryByKey.get(key) === task) retryByKey.delete(key)
    onRetryOutcome?.({ eventId: task.eventId, sessionId: task.sessionId, attempts: task.attempts, ok: true })
    return
  }
  task.attempts += 1
  if (task.attempts >= MAX_DELIVERY_ATTEMPTS) {
    task.state = 'exhausted'
    markExhausted(task.eventId, task.sessionId)
    if (retryByKey.get(key) === task) retryByKey.delete(key)
    onRetryOutcome?.({ eventId: task.eventId, sessionId: task.sessionId, attempts: task.attempts, ok: false })
    return
  }
  task.state = 'queued'
  markQueued(task.eventId, task.sessionId)
  scheduleNext(key, task)
}

/**
 * @param {string} key
 * @param {NotifyRetryTask} task
 */
function scheduleNext(key, task) {
  if (task.cancelled || !isAlarmRuntimeCurrent(task.runtimeEpoch)) return
  const delay = RETRY_DELAYS_MS[Math.min(task.attempts - 1, RETRY_DELAYS_MS.length - 1)]
  task.dueAt = nowFn() + delay
  if (task.timer) clearTimer(task.timer)
  task.state = 'queued'
  task.timer = setTimer(() => runRetryTask(task), delay)
  retryByKey.set(key, task)
}

/**
 * @param {{
 *   eventId: string,
 *   sessionId: string,
 *   home: any,
 *   cwd: string,
 *   summary: string,
 *   detail: string,
 *   opts: any,
 *   attempts: number,
 *   item: any,
 *   recipient: any,
 *   sourceSessionId?: string,
 *   recheck: (home: any, cwd: string, item: any, sessionId?: string) => any,
 * }} input
 * @returns {{ queued: boolean, attempts: number, dueAt?: number }}
 */
export function enqueueAlarmNotifyRetry(input) {
  const token = captureAlarmRuntimeToken()
  if (!isAlarmRuntimeCurrent(token)) return { queued: false, attempts: input.attempts || 0 }
  const eventId = String(input.eventId || '')
  const sessionId = String(input.sessionId || '')
  if (!eventId) return { queued: false, attempts: input.attempts || 0 }
  const attempts = Number(input.attempts) || 1
  if (attempts >= MAX_DELIVERY_ATTEMPTS) {
    markExhausted(eventId, sessionId)
    return { queued: false, attempts }
  }
  const key = retryKey(eventId, sessionId)
  const existing = retryByKey.get(key)
  if (existing && !existing.cancelled) {
    return { queued: true, attempts: existing.attempts, dueAt: existing.dueAt }
  }
  /** @type {NotifyRetryTask} */
  const task = {
    eventId,
    sessionId,
    home: input.home,
    cwd: input.cwd,
    summary: input.summary,
    detail: input.detail,
    opts: input.opts,
    attempts,
    enqueuedAt: nowFn(),
    dueAt: nowFn() + RETRY_DELAYS_MS[Math.min(attempts - 1, RETRY_DELAYS_MS.length - 1)],
    timer: null,
    recipient: input.recipient,
    item: input.item,
    sourceSessionId: input.sourceSessionId,
    runtimeEpoch: token,
    cancelled: false,
    state: 'queued',
    guards: { recheck: input.recheck },
  }
  markQueued(eventId, sessionId)
  scheduleNext(key, task)
  return { queued: true, attempts: task.attempts, dueAt: task.dueAt }
}

/**
 * @param {{ sessionId?: string, eventId?: string, cwd?: string, subscriptionId?: string }} [filter]
 */
export function cancelAlarmNotifyRetries(filter = {}) {
  for (const [key, task] of [...retryByKey.entries()]) {
    if (filter.sessionId && task.sessionId !== filter.sessionId) continue
    if (filter.eventId && task.eventId !== filter.eventId) continue
    if (filter.cwd && task.cwd !== filter.cwd) continue
    if (filter.subscriptionId && task.recipient?.subscriptionId !== filter.subscriptionId) continue
    task.cancelled = true
    task.state = 'cancelled'
    if (task.timer) {
      clearTimer(task.timer)
      task.timer = null
    }
    if (retryByKey.get(key) === task) retryByKey.delete(key)
  }
}

export function clearAlarmNotifyRetryRuntime() {
  for (const task of retryByKey.values()) {
    task.cancelled = true
    task.state = 'cancelled'
    if (task.timer) {
      clearTimer(task.timer)
      task.timer = null
    }
  }
  retryByKey.clear()
}

/** Test helper: run due tasks with their OWN carried guards. */
export function runDueAlarmNotifyRetries() {
  const now = nowFn()
  const due = [...retryByKey.values()].filter((t) => t.dueAt <= now && !t.cancelled)
  return Promise.all(due.map((task) => runRetryTask(task)))
}

export const _internal = {
  retryByKey,
  RETRY_DELAYS_MS,
  get size() {
    return retryByKey.size
  },
}
