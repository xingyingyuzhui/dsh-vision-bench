// @ts-check
/**
 * Web-only Host adapters: legacy `/vision-bench` RPC + Agent HTTP command bridge.
 * Mount only inside `ctx.inject(['webServer'], …)` so Desktop Host stays connection-only.
 */
import { toLosslessJson } from '../../application/commands/lossless-json.mjs'
import { handleCommand } from '../http/vision-command-routes.mjs'
import { VISION_RPC_CHANNEL } from '../../shared/vision-rpc-contract.mjs'

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
const CAPABILITY_HEADER = 'x-dsh-vision-capability'

/**
 * @typedef {{ writeHead: (status: number, headers?: Record<string, string>) => void, end: (body?: string) => void }} HttpResponseLike
 * @typedef {{
 *   method?: string,
 *   headers?: Record<string, string | string[] | undefined>,
 *   socket?: { remoteAddress?: string },
 *   connection?: { remoteAddress?: string },
 *   on: (event: string, listener: (...args: any[]) => void) => void,
 *   destroy?: () => void,
 * }} HttpRequestLike
 * @typedef {{ register: (entry: object) => unknown }} WebServerLike
 * @typedef {{ rpc: { handle: (channel: string, handler: Function) => unknown } }} ConnectionLike
 * @typedef {{ dispatch: (endpoint: string, payload: unknown, signal?: AbortSignal) => Promise<unknown> | unknown }} VisionRouterLike
 */

/**
 * @param {unknown} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  const payload = toLosslessJson(body)
  const safe = payload === undefined ? { ok: false, error: '响应无法序列化为 JSON' } : payload
  const httpRes = /** @type {HttpResponseLike} */ (res)
  httpRes.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  httpRes.end(JSON.stringify(safe))
}

/**
 * @param {HttpRequestLike} req
 * @param {number} [cap]
 * @returns {Promise<unknown>}
 */
function readJsonBody(req, cap = BODY_CAP) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    /** @type {Buffer[]} */
    const chunks = []
    req.on('data', (/** @type {Buffer | string} */ chunk) => {
      const buf = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk)
      size += buf.length
      if (size > cap) {
        reject(new Error('payload too large'))
        if (typeof req.destroy === 'function') req.destroy()
        return
      }
      chunks.push(buf)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8')
        resolveBody(text ? JSON.parse(text) : {})
      } catch (err) {
        reject(err)
      }
    })
    req.on('error', reject)
  })
}

/**
 * @param {unknown} addr
 * @returns {boolean}
 */
function isLoopbackAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

/**
 * @param {HttpRequestLike} req
 * @returns {string}
 */
function socketAddress(req) {
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || ''
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorMessage(error) {
  if (error instanceof Error) return error.message
  return String(error || '')
}

/**
 * @param {HttpRequestLike} req
 * @param {HttpResponseLike} res
 * @param {{ capabilityMatches: (provided: string) => boolean }} caps
 * @returns {boolean}
 */
export function guardAgentCommandBridge(req, res, caps) {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }
  if (!isLoopbackAddress(socketAddress(req))) {
    writeJson(res, 403, { ok: false, error: 'loopback only' })
    return false
  }
  const headers = (req && req.headers) || {}
  const origin = headers.origin || headers.Origin
  if (origin && !LOOPBACK_ORIGIN.test(String(origin))) {
    writeJson(res, 403, { ok: false, error: 'forbidden origin' })
    return false
  }
  const ctype = String(headers['content-type'] || headers['Content-Type'] || '')
  if (ctype && !/^application\/json\b/i.test(ctype)) {
    writeJson(res, 415, { ok: false, error: 'content-type must be application/json' })
    return false
  }
  const cap = headers[CAPABILITY_HEADER] || headers['X-DSH-Vision-Capability'] || ''
  if (!cap) {
    writeJson(res, 403, { ok: false, error: 'missing capability' })
    return false
  }
  if (!caps.capabilityMatches(String(cap))) {
    writeJson(res, 403, { ok: false, error: 'invalid capability' })
    return false
  }
  return true
}

/**
 * Normalize a Cordis-style disposer that may be sync, async, or a Promise of a disposer.
 * @param {unknown} registration
 * @returns {Promise<() => unknown>}
 */
function resolveDisposer(registration) {
  return Promise.resolve(registration).then((dispose) => {
    if (typeof dispose === 'function') return /** @type {() => unknown} */ (dispose)
    return () => Promise.resolve()
  })
}

/**
 * @param {{
 *   connection: ConnectionLike,
 *   webServer: WebServerLike,
 *   router: VisionRouterLike,
 *   dshHome: string,
 *   touchSession: (sessionId: string) => void,
 *   capabilityMatches: (provided: string) => boolean,
 *   commandDeps?: object,
 * }} opts
 * @returns {{ stop: () => Promise<void>, httpPaths: string[] }}
 */
export function mountVisionWebCompat(opts) {
  const { connection, webServer, router, dshHome, touchSession, capabilityMatches, commandDeps = {} } = opts
  if (!connection?.rpc?.handle || typeof connection.rpc.handle !== 'function') {
    throw new Error('dsh-vision-bench: Web compat requires ctx.connection.rpc.handle')
  }
  if (!webServer?.register || typeof webServer.register !== 'function') {
    throw new Error('dsh-vision-bench: Web compat requires ctx.webServer.register')
  }

  const stopRpcRegistration = connection.rpc.handle(
    VISION_RPC_CHANNEL,
    async (/** @type {string} */ endpoint, /** @type {unknown} */ payload, /** @type {AbortSignal | undefined} */ signal) => {
      try {
        const value = await router.dispatch(endpoint, payload, signal)
        return { ok: true, value }
      } catch (error) {
        return {
          ok: false,
          error: {
            code: 'internal',
            message: errorMessage(error).slice(0, 300),
            details: {},
          },
        }
      }
    },
  )
  const rpcRegistration = resolveDisposer(stopRpcRegistration)
  /** @type {Promise<void> | null} */
  let rpcStopPromise = null
  const safeStopRpc = () => {
    if (!rpcStopPromise) {
      rpcStopPromise = rpcRegistration
        .then((dispose) => dispose())
        .then(() => undefined)
        .catch(() => {})
    }
    return rpcStopPromise
  }

  /**
   * @param {HttpRequestLike} req
   * @returns {Promise<unknown>}
   */
  const readBodyAndTouchSession = async (req) => {
    const body = await readJsonBody(req)
    const sessionId =
      body && typeof body === 'object' && /** @type {{ sessionId?: unknown }} */ (body).sessionId
        ? String(/** @type {{ sessionId?: unknown }} */ (body).sessionId)
        : ''
    if (sessionId) touchSession(sessionId)
    return body
  }

  /**
   * @param {HttpRequestLike} req
   * @param {HttpResponseLike} res
   * @param {() => Promise<unknown>} fn
   */
  const respond = async (req, res, fn) => {
    try {
      const body = await fn()
      writeJson(res, 200, body)
    } catch (error) {
      writeJson(res, 200, { ok: false, error: errorMessage(error).slice(0, 300) })
    }
  }

  const commandEntry = {
    kind: 'exact',
    path: '/dsh-vision-bench/command',
    /**
     * @param {HttpRequestLike} req
     * @param {HttpResponseLike} res
     */
    handler: (req, res) => {
      if (!guardAgentCommandBridge(req, res, { capabilityMatches })) return
      respond(req, res, () => handleCommand(dshHome, req, readBodyAndTouchSession, commandDeps))
    },
  }
  const routeDisposeRegistration = resolveDisposer(webServer.register(commandEntry))
  /** @type {Promise<void> | null} */
  let routeStopPromise = null
  const safeStopRoute = () => {
    if (!routeStopPromise) {
      routeStopPromise = routeDisposeRegistration
        .then((dispose) => dispose())
        .then(() => undefined)
        .catch(() => {})
    }
    return routeStopPromise
  }

  /** @type {Promise<void> | null} */
  let stopPromise = null
  return {
    httpPaths: [commandEntry.path],
    stop() {
      if (stopPromise) return stopPromise
      stopPromise = Promise.allSettled([safeStopRoute(), safeStopRpc()]).then(() => undefined)
      return stopPromise
    },
  }
}
