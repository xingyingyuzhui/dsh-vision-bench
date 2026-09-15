// @ts-check

/**
 * Race a promise with an AbortSignal, rejecting with TimeoutError/AbortError on abort.
 * @template T
 * @param {Promise<T>} promise
 * @param {AbortSignal} [signal]
 * @returns {Promise<T>}
 */
export function withTimeoutSignal(promise, signal) {
  if (!signal) return promise
  if (signal.aborted) {
    const isTimeout = signal.reason?.message === 'VERIFY_TIMEOUT' || signal.reason?.name === 'TimeoutError'
    const err = new Error(isTimeout ? 'VERIFY_TIMEOUT' : 'VERIFY_CANCELLED')
    err.name = isTimeout ? 'TimeoutError' : 'AbortError'
    return Promise.reject(err)
  }
  return new Promise((resolve, reject) => {
    let settled = false
    const onAbort = () => {
      if (settled) return
      settled = true
      const isTimeout = signal.reason?.message === 'VERIFY_TIMEOUT' || signal.reason?.name === 'TimeoutError'
      const err = new Error(isTimeout ? 'VERIFY_TIMEOUT' : 'VERIFY_CANCELLED')
      err.name = isTimeout ? 'TimeoutError' : 'AbortError'
      reject(err)
    }
    signal.addEventListener('abort', onAbort, { once: true })
    promise
      .then((val) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        resolve(val)
      })
      .catch((err) => {
        if (settled) return
        settled = true
        signal.removeEventListener('abort', onAbort)
        reject(err)
      })
  })
}

/**
 * @param {unknown} err
 * @param {AbortSignal} [signal]
 * @returns {boolean}
 */
export function isTimeoutOrAborted(err, signal) {
  const e = /** @type {any} */ (err)
  return Boolean(signal?.aborted || e?.name === 'TimeoutError' || e?.message === 'VERIFY_TIMEOUT')
}
