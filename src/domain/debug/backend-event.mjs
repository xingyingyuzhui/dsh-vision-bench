// @ts-check

export const BACKEND_EVENT_TYPES = {
  RUNNING: 'backend.running',
  STOPPED: 'backend.stopped',
  CONSOLE: 'backend.console',
  EXITED: 'backend.exited',
  ERROR: 'backend.error',
}

/**
 * Creates a normalized backend event.
 * @param {string | import('../../types/debug-backend.d.ts').DebugBackendEvent} typeOrEvent
 * @param {Record<string, any>} [payload]
 * @returns {import('../../types/debug-backend.d.ts').DebugBackendEvent}
 */
export function createBackendEvent(typeOrEvent, payload = {}) {
  if (typeof typeOrEvent === 'object' && typeOrEvent !== null) {
    return typeOrEvent
  }
  const type = String(typeOrEvent)
  if (!Object.values(BACKEND_EVENT_TYPES).includes(type)) {
    throw new Error(`Invalid backend event type: ${type}`)
  }
  return /** @type {any} */ ({
    type,
    ...payload,
  })
}
