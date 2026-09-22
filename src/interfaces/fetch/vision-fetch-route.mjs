// @ts-check
/**
 * Shared Connection exact Fetch route for Vision UI (Web + Desktop).
 * Transport envelope mirrors rpc.handle: `{ ok: true, value }` / `{ ok: false, error }`.
 * Body size is enforced by Connection `maxRequestBodyBytes` — do not re-cap here.
 */
import { toLosslessJson } from '../../application/commands/lossless-json.mjs'
import {
  isVisionRpcEndpoint,
  VISION_FETCH_DISPATCH_PATH,
} from '../../shared/vision-rpc-contract.mjs'

/**
 * @param {unknown} body
 * @returns {{ endpoint: string, payload: Record<string, unknown> } | { error: string, status: number }}
 */
function parseDispatchBody(body) {
  if (!body || typeof body !== 'object' || Array.isArray(body)) {
    return { error: 'body must be a JSON object', status: 400 }
  }
  const row = /** @type {Record<string, unknown>} */ (body)
  const endpoint = typeof row.endpoint === 'string' ? row.endpoint : ''
  if (!endpoint || !isVisionRpcEndpoint(endpoint)) {
    return { error: 'unknown or missing endpoint', status: 400 }
  }
  if (!Object.prototype.hasOwnProperty.call(row, 'payload') || row.payload == null) {
    return { endpoint, payload: {} }
  }
  if (typeof row.payload !== 'object' || Array.isArray(row.payload)) {
    return { error: 'payload must be a JSON object', status: 400 }
  }
  return { endpoint, payload: /** @type {Record<string, unknown>} */ (row.payload) }
}

/**
 * @param {{ dispatch: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown> }} router
 * @returns {(request: Request) => Promise<Response>}
 */
export function createVisionFetchDispatchHandler(router) {
  return async function visionFetchDispatch(request) {
    if (request.method !== 'POST') {
      return Response.json({ ok: false, error: { code: 'method', message: 'POST only' } }, { status: 405 })
    }
    const ctype = String(request.headers.get('content-type') || '')
    if (ctype && !/^application\/json\b/i.test(ctype)) {
      return Response.json(
        { ok: false, error: { code: 'content-type', message: 'application/json required' } },
        { status: 415 },
      )
    }
    let body
    try {
      const text = await request.text()
      body = text ? JSON.parse(text) : {}
    } catch {
      return Response.json({ ok: false, error: { code: 'json', message: 'invalid JSON' } }, { status: 400 })
    }
    const parsed = parseDispatchBody(body)
    if ('error' in parsed) {
      return Response.json(
        { ok: false, error: { code: 'request', message: parsed.error } },
        { status: parsed.status },
      )
    }
    try {
      const value = await router.dispatch(parsed.endpoint, parsed.payload, request.signal)
      const envelope = toLosslessJson({ ok: true, value })
      if (envelope === undefined) {
        return Response.json(
          { ok: false, error: { code: 'encode', message: 'response not JSON' } },
          { status: 500 },
        )
      }
      return Response.json(envelope)
    } catch (error) {
      const message = String((error && /** @type {Error} */ (error).message) || error).slice(0, 300)
      const aborted =
        request.signal?.aborted ||
        (error && typeof error === 'object' && 'name' in error && error.name === 'AbortError')
      if (aborted) {
        return Response.json({
          ok: false,
          error: {
            code: 'cancelled',
            message: 'aborted',
            details: {},
          },
        })
      }
      return Response.json(
        {
          ok: false,
          error: {
            code: 'internal',
            message,
            details: {},
          },
        },
        { status: 500 },
      )
    }
  }
}

/**
 * Register `/api/vision-bench/dispatch` on Connection fetch registry.
 * Supports sync disposer or Promise that resolves to a disposer (late registration).
 * @param {{ fetch?: { register?: (route: object) => unknown } }} connection
 * @param {{ dispatch: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown> }} router
 * @returns {() => void | Promise<void>}
 */
export function registerVisionFetchDispatch(connection, router) {
  if (!connection?.fetch?.register || typeof connection.fetch.register !== 'function') {
    throw new Error('dsh-vision-bench: Host requires ctx.connection.fetch.register')
  }
  const registration = connection.fetch.register({
    path: VISION_FETCH_DISPATCH_PATH,
    methods: ['POST'],
    requestBody: 'buffered',
    fetch: createVisionFetchDispatchHandler(router),
  })
  const resolved = Promise.resolve(
    typeof registration === 'function'
      ? registration
      : registration && typeof /** @type {{ then?: unknown }} */ (registration).then === 'function'
        ? registration
        : () => {},
  )
  /** @type {Promise<void> | null} */
  let stopPromise = null
  return () => {
    if (!stopPromise) {
      stopPromise = resolved
        .then((dispose) => (typeof dispose === 'function' ? dispose() : undefined))
        .then(() => undefined)
        .catch(() => {})
    }
    return stopPromise
  }
}
