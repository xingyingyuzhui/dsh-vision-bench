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
 * @param {unknown} res
 * @param {number} status
 * @param {unknown} body
 */
function writeJson(res, status, body) {
  const payload = toLosslessJson(body)
  const safe = payload === undefined ? { ok: false, error: '响应无法序列化为 JSON' } : payload
  const httpRes = /** @type {any} */ (res)
  httpRes.writeHead(status, {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
  })
  httpRes.end(JSON.stringify(safe))
}

/**
 * @param {any} req
 * @param {number} [cap]
 */
function readJsonBody(req, cap = BODY_CAP) {
  return new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('payload too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
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

function isLoopbackAddress(addr) {
  const a = String(addr || '').replace(/^::ffff:/, '')
  return a === '127.0.0.1' || a === '::1' || a === 'localhost'
}

function socketAddress(req) {
  return req?.socket?.remoteAddress || req?.connection?.remoteAddress || ''
}

/**
 * @param {any} req
 * @param {any} res
 * @param {{ capabilityMatches: (provided: string) => boolean }} caps
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
  if (origin && !LOOPBACK_ORIGIN.test(origin)) {
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
  if (!caps.capabilityMatches(cap)) {
    writeJson(res, 403, { ok: false, error: 'invalid capability' })
    return false
  }
  return true
}

/**
 * @param {{
 *   connection: any,
 *   webServer: { register: (entry: object) => unknown },
 *   router: { dispatch: Function },
 *   dshHome: string,
 *   touchSession: (sessionId: string) => void,
 *   capabilityMatches: (provided: string) => boolean,
 *   commandDeps?: object,
 * }} opts
 * @returns {{ stop: () => Promise<void> | void, httpPaths: string[] }}
 */
export function mountVisionWebCompat(opts) {
  const { connection, webServer, router, dshHome, touchSession, capabilityMatches, commandDeps = {} } = opts
  if (!connection?.rpc?.handle || typeof connection.rpc.handle !== 'function') {
    throw new Error('dsh-vision-bench: Web compat requires ctx.connection.rpc.handle')
  }
  if (!webServer?.register || typeof webServer.register !== 'function') {
    throw new Error('dsh-vision-bench: Web compat requires ctx.webServer.register')
  }

  const stopRpcRegistration = connection.rpc.handle(VISION_RPC_CHANNEL, async (endpoint, payload, signal) => {
    try {
      const value = await router.dispatch(endpoint, payload, signal)
      return { ok: true, value }
    } catch (error) {
      return {
        ok: false,
        error: {
          code: 'internal',
          message: String((error && error.message) || error).slice(0, 300),
          details: {},
        },
      }
    }
  })
  const rpcRegistration = Promise.resolve(
    typeof stopRpcRegistration === 'function'
      ? stopRpcRegistration
      : stopRpcRegistration && typeof stopRpcRegistration.then === 'function'
        ? stopRpcRegistration
        : () => Promise.resolve(),
  )
  let rpcStopPromise = null
  const safeStopRpc = () => {
    if (!rpcStopPromise) {
      rpcStopPromise = rpcRegistration
        .then((dispose) => (typeof dispose === 'function' ? dispose() : undefined))
        .catch(() => {})
    }
    return rpcStopPromise
  }

  const readBodyAndTouchSession = async (req) => {
    const body = await readJsonBody(req)
    const sessionId = body && typeof body === 'object' && body.sessionId ? String(body.sessionId) : ''
    if (sessionId) touchSession(sessionId)
    return body
  }

  const respond = async (req, res, fn) => {
    try {
      const body = await fn()
      writeJson(res, 200, body)
    } catch (error) {
      writeJson(res, 200, { ok: false, error: String((error && error.message) || error).slice(0, 300) })
    }
  }

  const commandEntry = {
    kind: 'exact',
    path: '/dsh-vision-bench/command',
    handler: (req, res) => {
      if (!guardAgentCommandBridge(req, res, { capabilityMatches })) return
      respond(req, res, () => handleCommand(dshHome, req, readBodyAndTouchSession, commandDeps))
    },
  }
  const routeDispose = webServer.register(commandEntry)

  let stopped = false
  return {
    httpPaths: [commandEntry.path],
    stop() {
      if (stopped) return
      stopped = true
      try {
        if (typeof routeDispose === 'function') routeDispose()
      } catch {
        /* ignore */
      }
      return safeStopRpc()
    },
  }
}
