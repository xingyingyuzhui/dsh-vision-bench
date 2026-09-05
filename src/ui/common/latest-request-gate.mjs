/** Monotonic request generation for async UI gates. */
export function beginRequest(ref) {
  ref.current += 1
  return ref.current
}

/**
 * True when a response may still update live UI state.
 * @param {{ current: number }} ref
 * @param {number} requestId
 * @param {string} identityKey identity captured when the request started
 * @param {string} currentIdentityKey live page identity
 * @param {{ current: boolean }} mountedRef
 */
export function shouldApplyRequest(ref, requestId, identityKey, currentIdentityKey, mountedRef) {
  if (mountedRef && mountedRef.current === false) return false
  if (requestId !== ref.current) return false
  if (identityKey !== currentIdentityKey) return false
  return true
}

/**
 * Wrap post() so an AbortSignal can drop late responses even when fetch lacks signal support.
 * @param {(path: string, payload?: object, options?: any) => Promise<unknown>} post
 * @param {string} path
 * @param {object} [payload]
 * @param {AbortSignal} [signal]
 * @param {any} [options]
 */
export function postWithAbort(post, path, payload, signal, options) {
  const timeoutMs =
    typeof options === 'number'
      ? options
      : options && typeof options === 'object' && options.timeoutMs
        ? options.timeoutMs
        : undefined
  const postOptions = timeoutMs ? { timeoutMs, signal } : signal ? { signal } : undefined
  const run = post(path, payload, postOptions || timeoutMs)
  if (!signal) return run
  if (signal.aborted) return Promise.reject(new DOMException('Aborted', 'AbortError'))
  return new Promise((resolve, reject) => {
    const onAbort = () => {
      signal.removeEventListener('abort', onAbort)
      reject(new DOMException('Aborted', 'AbortError'))
    }
    signal.addEventListener('abort', onAbort)
    run.then(
      (value) => {
        signal.removeEventListener('abort', onAbort)
        if (signal.aborted) reject(new DOMException('Aborted', 'AbortError'))
        else resolve(value)
      },
      (err) => {
        signal.removeEventListener('abort', onAbort)
        reject(err)
      },
    )
  })
}
