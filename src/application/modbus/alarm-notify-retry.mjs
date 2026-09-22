// @ts-check
/**
 * Bounded in-memory retry queue for failed alarm followups.
 * Delays 1s / 3s / 10s, at most 3 attempts, same eventId per recipient.
 * Process restart drops the queue (documented); dispose clears timers.
 */
import {
  MAX_DELIVERY_ATTEMPTS,
  beginDeliveryAttempt,
  deliverNotify,
  markDelivered,
  markExhausted,
  markQueued,
} from './alarm-notify-registry.mjs'
import { recipientStillAuthorized } from './alarm-notify-match.mjs'

export const RETRY_DELAYS_MS = [1_000, 3_000, 10_000]

/**
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
 * Re-validate before spending another attempt: the ORIGINAL authorization
 * reason still holds, the event target still matches, and the alarm is live.
 *
 * @param {NotifyRetryTask} task
 * @param {{
 *   recheck: (home: any, cwd: string, item: any, sessionId?: string) => any,
 *   item: any,
 * }} guards
 */
function guardsPass(task, guards) {
  const item = task.item || guards?.item
  // 1+2. Original auth reason (watch subscriptionId / focus / command id) still covers the event.
  if (!recipientStillAuthorized(task.home, task.cwd, item, task.recipient)) return false
  // 3. Alarm still valid (not recovered / deleted / disabled).
  if (!guards || typeof guards.recheck !== 'function') return true
  try {
    const live = guards.recheck(task.home, task.cwd, item, task.sessionId)
    return !!(live && live.current)
  } catch {
    return false
  }
}

/**
 * @param {string} key
 * @param {NotifyRetryTask} task
 * @param {{ recheck: (home: any, cwd: string, item: any, sessionId?: string) => any, item: any }} guards
 */
function scheduleNext(key, task, guards) {
  const delay = RETRY_DELAYS_MS[Math.min(task.attempts, RETRY_DELAYS_MS.length - 1)]
  task.dueAt = nowFn() + delay
  if (task.timer) clearTimer(task.timer)
  task.timer = setTimer(() => {
    retryByKey.delete(key)
    return runRetryTask(task, guards)
  }, delay)
  retryByKey.set(key, task)
}

/**
 * @param {NotifyRetryTask} task
 * @param {{ recheck: (home: any, cwd: string, item: any, sessionId?: string) => any, item: any }} guards
 */
async function runRetryTask(task, guards) {
  const key = retryKey(task.eventId, task.sessionId)
  if (!guardsPass(task, guards)) {
    markExhausted(task.eventId, task.sessionId)
    onRetryOutcome?.({ eventId: task.eventId, sessionId: task.sessionId, attempts: task.attempts, ok: false })
    return
  }
  const attempt = beginDeliveryAttempt(task.eventId, task.sessionId)
  if (!attempt.proceed) {
    if (attempt.entry?.state === 'delivered' || attempt.entry?.state === 'exhausted') {
      retryByKey.delete(key)
    }
    return
  }
  let delivered
  try {
    delivered = await deliverNotify(task.home, task.cwd, task.summary, task.detail, task.opts)
  } catch {
    delivered = { ok: false }
  }
  if (delivered && delivered.ok === true) {
    markDelivered(task.eventId, task.sessionId)
    retryByKey.delete(key)
    onRetryOutcome?.({ eventId: task.eventId, sessionId: task.sessionId, attempts: task.attempts, ok: true })
    return
  }
  task.attempts += 1
  if (task.attempts >= MAX_DELIVERY_ATTEMPTS) {
    markExhausted(task.eventId, task.sessionId)
    retryByKey.delete(key)
    onRetryOutcome?.({ eventId: task.eventId, sessionId: task.sessionId, attempts: task.attempts, ok: false })
    return
  }
  markQueued(task.eventId, task.sessionId)
  scheduleNext(key, task, guards)
}

/**
 * Queue one failed recipient delivery. Same eventId is reused across retries.
 *
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
  if (existing) return { queued: true, attempts: existing.attempts, dueAt: existing.dueAt }
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
  }
  markQueued(eventId, sessionId)
  scheduleNext(key, task, { recheck: input.recheck, item: input.item })
  return { queued: true, attempts: task.attempts, dueAt: task.dueAt }
}

/**
 * Cancel queued retries (e.g. watch cleared / subscription identity changed).
 * @param {{ sessionId?: string, eventId?: string, cwd?: string, subscriptionId?: string }} [filter]
 */
export function cancelAlarmNotifyRetries(filter = {}) {
  for (const [key, task] of [...retryByKey.entries()]) {
    if (filter.sessionId && task.sessionId !== filter.sessionId) continue
    if (filter.eventId && task.eventId !== filter.eventId) continue
    if (filter.cwd && task.cwd !== filter.cwd) continue
    if (filter.subscriptionId && task.recipient?.subscriptionId !== filter.subscriptionId) continue
    if (task.timer) clearTimer(task.timer)
    retryByKey.delete(key)
    markExhausted(task.eventId, task.sessionId)
  }
}

/** Host dispose: drop every timer + queued task. */
export function clearAlarmNotifyRetryRuntime() {
  for (const task of retryByKey.values()) {
    if (task.timer) clearTimer(task.timer)
  }
  retryByKey.clear()
}

/**
 * @param {{
 *   recheck: (home: any, cwd: string, item: any, sessionId?: string) => any,
 *   item: any,
 * }} guards
 */
export function runDueAlarmNotifyRetries(guards) {
  const now = nowFn()
  const due = [...retryByKey.values()].filter((t) => t.dueAt <= now)
  return Promise.all(due.map((task) => runRetryTask(task, guards)))
}

export const _internal = {
  retryByKey,
  RETRY_DELAYS_MS,
  get size() {
    return retryByKey.size
  },
}
