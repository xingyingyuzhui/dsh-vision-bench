// @ts-check

/**
 * Composes multiple AbortSignals into a single AbortSignal that triggers
 * whenever any of the input signals abort.
 *
 * @param {Array<AbortSignal | undefined | null>} signals
 * @returns {AbortSignal}
 */
export function composeAbortSignals(signals) {
  const validSignals = /** @type {AbortSignal[]} */ (
    (signals || []).filter((s) => s && typeof s === 'object' && typeof s.addEventListener === 'function')
  )

  if (validSignals.length === 0) {
    return new AbortController().signal
  }

  if (validSignals.length === 1) {
    return /** @type {AbortSignal} */ (validSignals[0])
  }

  if (typeof AbortSignal.any === 'function') {
    return AbortSignal.any(/** @type {AbortSignal[]} */ (validSignals))
  }

  // Fallback for environments where AbortSignal.any is not available
  const controller = new AbortController()
  for (const sig of validSignals) {
    if (sig.aborted) {
      controller.abort(sig.reason)
      return controller.signal
    }
    sig.addEventListener('abort', () => controller.abort(sig.reason), { once: true })
  }
  return controller.signal
}

/**
 * Creates an abortable delay that resolves after `ms` or rejects with an abort reason.
 *
 * @param {number} ms
 * @param {AbortSignal} [signal]
 * @returns {Promise<void>}
 */
export function abortableDelay(ms, signal) {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      const err = new Error('ABORTED')
      err.name = 'AbortError'
      return reject(err)
    }

    const timer = setTimeout(() => {
      cleanup()
      resolve()
    }, ms)

    function onAbort() {
      clearTimeout(timer)
      cleanup()
      const err = new Error('ABORTED')
      err.name = 'AbortError'
      reject(err)
    }

    function cleanup() {
      signal?.removeEventListener('abort', onAbort)
    }

    signal?.addEventListener('abort', onAbort, { once: true })
  })
}
