// @ts-check

import { DEBUG_EVENT_TYPES } from '../../../shared/debug-events.mjs'

/**
 * Normalizes legacy event alias strings to canonical DEBUG_EVENT_TYPES.
 * @param {string} [type]
 * @returns {string}
 */
export function normalizeDebugEventType(type) {
  const t = String(type || '')
  if (t === 'running') return DEBUG_EVENT_TYPES.RUNNING
  if (t === 'paused') return DEBUG_EVENT_TYPES.PAUSED
  if (t === 'step_complete') return DEBUG_EVENT_TYPES.STEP_COMPLETE
  if (t === 'breakpoint_hit') return DEBUG_EVENT_TYPES.BREAKPOINT_HIT
  if (t === 'watchpoint_hit') return DEBUG_EVENT_TYPES.WATCHPOINT_HIT
  if (t === 'session_stopped') return DEBUG_EVENT_TYPES.SESSION_STOPPED
  return t
}

/**
 * Projects a batch of debug events into UI status setters.
 * Returns whether a full state refresh is needed.
 *
 * @param {any[]} incoming
 * @param {{
 *   setStatus: (s: string) => void,
 *   setPendingControl: (v: any) => void,
 *   setActive: (v: boolean) => void,
 * }} setters
 * @returns {boolean}
 */
export function projectDebugEvents(incoming, setters) {
  const { setStatus, setPendingControl, setActive } = setters
  let needStateRefresh = false
  for (const ev of incoming) {
    const type = normalizeDebugEventType(ev.type)
    if (type === DEBUG_EVENT_TYPES.RUNNING) {
      setStatus('running')
      setPendingControl(null)
    } else if (
      type === DEBUG_EVENT_TYPES.PAUSED ||
      type === DEBUG_EVENT_TYPES.STEP_COMPLETE ||
      type === DEBUG_EVENT_TYPES.BREAKPOINT_HIT ||
      type === DEBUG_EVENT_TYPES.WATCHPOINT_HIT
    ) {
      setStatus('paused')
      setPendingControl(null)
      needStateRefresh = true
    } else if (type === DEBUG_EVENT_TYPES.EXCEPTION) {
      setStatus('failed')
      setPendingControl(null)
      needStateRefresh = true
    } else if (type === DEBUG_EVENT_TYPES.SESSION_STOPPED) {
      setStatus('stopped')
      setActive(false)
      setPendingControl(null)
      needStateRefresh = true
    } else if (type.includes('breakpoint') || type.includes('watchpoint') || type.includes('snapshot')) {
      needStateRefresh = true
    }
  }
  return needStateRefresh
}
