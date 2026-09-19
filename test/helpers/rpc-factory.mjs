// @ts-check
/**
 * P1-2：Host / RPC / 审批测试工厂。
 *
 * 抽取前，RPC 的**外层 envelope 契约**（`host.js` 里 `rpc.handle` 的返回值）
 * 在测试中被手写了 10 次——仅 `vision-connection-rpc.test.mjs` 一个文件里就有
 * 8 处 `{ ok: true, value: … }` 与 2 处 `{ ok: false, error: { code, message, details } }`。
 *
 * 手写 envelope 的问题不是啰嗦，而是**契约漂移**：`host.js` 换了形状，测试仍会用旧形状
 * 构造 mock 并继续通过。本模块把三层契约各收口到一处，并用测试对照 `host.js` 的真实返回值
 * （见 `test/architecture/rpc-factory.test.mjs`）。
 *
 *   - 外层 envelope：`rpcOk` / `rpcFail`
 *   - 内层业务结果：`businessOk` / `businessFail`
 *   - 宿主侧注册：`mockRpcHost` / `createHostContext`
 *   - 浏览器侧调用：`mockConnection` / `createPost`
 *   - 进程内派发：`createRouter`（含 `dispatchAs` 跨会话）
 *
 * 五种场景的写法：
 *
 * ```js
 * mockConnection(() => businessOk({ workspace }))                  // 成功
 * mockConnection(() => businessFail('CONFIG_DRIFT', '请刷新'))       // 结构化失败
 * mockConnection(() => rpcFail('forbidden', 'unauthenticated'))     // transport failure
 * mockConnection((_ep, _pl, signal) =>                              // 取消
 *   signal?.aborted ? rpcFail('cancelled', 'aborted') : businessOk())
 * mockConnection((_ep, payload) =>                                  // 跨会话
 *   payload.sessionId === 'a' ? businessOk({ who: 'a' }) : businessFail('SESSION_MISMATCH', 'x'))
 * ```
 */

import { Readable } from 'node:stream'
import { _internal, apply as applyHost } from '../../host.js'
import { createVisionRpcPost } from '../../src/infrastructure/host/vision-rpc-client.mjs'
import { createVisionRpcRouter } from '../../src/interfaces/rpc/vision-rpc-router.mjs'
import { VISION_RPC_CHANNEL } from '../../src/shared/vision-rpc-contract.mjs'

export { _internal, applyHost, VISION_RPC_CHANNEL }

// ---------------------------------------------------------------------------
// 外层 envelope —— host.js 的 rpc.handle 契约
// ---------------------------------------------------------------------------

/**
 * 成功 envelope。`value` 是 `router.dispatch` 的业务结果。
 * @param {any} value
 */
export function rpcOk(value) {
  return { ok: true, value }
}

/**
 * 宿主/传输层失败 envelope。业务层的失败**不是**这个形状——业务失败会被
 * 包进 `rpcOk`，由客户端 `createVisionRpcPost` 解包后原样返回。
 * @param {string} code
 * @param {string} message
 * @param {Record<string, any>} [details]
 */
export function rpcFail(code, message, details = {}) {
  return { ok: false, error: { code, message, details } }
}

/** @param {any} value */
function isEnvelope(value) {
  if (!value || typeof value !== 'object') return false
  if (value.ok === true && 'value' in value) return true
  return value.ok === false && !!value.error && typeof value.error === 'object'
}

// ---------------------------------------------------------------------------
// 内层业务结果 —— router.dispatch 的返回形状
// ---------------------------------------------------------------------------

/** @param {Record<string, any>} [extra] */
export function businessOk(extra = {}) {
  return { ok: true, ...extra }
}

/**
 * @param {string} errorCode
 * @param {string} error
 * @param {Record<string, any>} [extra] 例如 `{ needsConfirm: true, request }`
 */
export function businessFail(errorCode, error, extra = {}) {
  return { ok: false, errorCode, error, ...extra }
}

// ---------------------------------------------------------------------------
// 浏览器侧：connection.rpc.call
// ---------------------------------------------------------------------------

/**
 * 记录每次调用的 `connection.rpc.call` mock。
 *
 * `handler(endpoint, payload, signal)` 返回 envelope（`rpcOk`/`rpcFail`）或裸业务结果
 * （自动包进 `rpcOk`）。返回 envelope 时原样透传，所以 transport failure 可以被表达。
 *
 * @param {(endpoint: string, payload: any, signal?: AbortSignal) => any} handler
 */
export function mockConnection(handler) {
  /** @type {Array<{ channel: string, endpoint: string, payload: any, signal?: AbortSignal }>} */
  const calls = []
  const connection = {
    rpc: {
      async call(channel, endpoint, payload, signal) {
        if (channel !== VISION_RPC_CHANNEL) throw new Error(`unexpected RPC channel ${channel}`)
        calls.push({ channel, endpoint, payload, signal })
        const out = await handler(endpoint, payload, signal)
        return isEnvelope(out) ? out : rpcOk(out)
      },
    },
  }
  return { calls, connection, lastCall: () => calls[calls.length - 1] }
}

/**
 * 在 `mockConnection` 之上构建浏览器侧 `post(path, body, timeoutOrOptions)`。
 *
 * @param {(endpoint: string, payload: any, signal?: AbortSignal) => any} handler
 */
export function createPost(handler) {
  const mock = mockConnection(handler)
  return { calls: mock.calls, lastCall: mock.lastCall, connection: mock.connection, post: createVisionRpcPost(mock.connection) }
}

// ---------------------------------------------------------------------------
// 宿主侧：ctx.connection.rpc.handle
// ---------------------------------------------------------------------------

/**
 * 模拟宿主侧的 RPC 注册通道：`rpc.handle(channel, handler)` 与反向 `rpc.call(...)`。
 * `invoke()` 直接调用已注册的 handler，拿到 `host.js` 产出的**真实** envelope。
 */
export function mockRpcHost() {
  /** @type {((endpoint: string, payload: any, signal?: AbortSignal) => any) | null} */
  let handler = null
  /** @type {((request: Request) => Promise<Response>) | null} */
  let fetchHandler = null
  let disposed = false
  let fetchDisposed = false
  return {
    rpc: {
      handle(channel, fn) {
        if (channel !== VISION_RPC_CHANNEL) throw new Error(`unexpected RPC channel ${channel}`)
        handler = fn
        return () => {
          disposed = true
          handler = null
          return Promise.resolve()
        }
      },
      async call(_channel, endpoint, payload, signal) {
        if (!handler) throw new Error('rpc handler missing')
        return handler(endpoint, payload, signal)
      },
    },
    fetch: {
      register(route) {
        if (!route || typeof route.fetch !== 'function') throw new Error('invalid fetch route')
        fetchHandler = route.fetch
        return () => {
          fetchDisposed = true
          fetchHandler = null
        }
      },
    },
    get disposed() {
      return disposed
    },
    get fetchDisposed() {
      return fetchDisposed
    },
    get hasHandler() {
      return handler != null
    },
    get hasFetchHandler() {
      return fetchHandler != null
    },
    invoke(endpoint, payload, signal) {
      if (!handler) throw new Error('rpc handler missing')
      return handler(endpoint, payload, signal)
    },
    /**
     * @param {string} endpoint
     * @param {any} [payload]
     * @param {AbortSignal} [signal]
     */
    async invokeFetch(endpoint, payload = {}, signal) {
      if (!fetchHandler) throw new Error('fetch handler missing')
      const request = new Request('http://host/api/vision-bench/dispatch', {
        method: 'POST',
        headers: { 'content-type': 'application/json' },
        body: JSON.stringify({ endpoint, payload }),
        signal,
      })
      return fetchHandler(request)
    },
  }
}

/**
 * 宿主插件上下文 mock：`webServer.register` 收集路由，`tools.register` 收集工具，
 * `effect(factory)` 把清理函数挂到 `ctx._stop`。`overrides` 用于需要定制
 * `connection.register`（返回 Promise 的迟到 disposer）或 `systemPrompt` 的场景。
 *
 * @param {any} connection
 * @param {Record<string, any>} [overrides]
 */
export function createHostContext(connection, overrides = {}) {
  const routes = []
  const tools = []
  /** @type {Array<() => unknown>} */
  const childStops = []
  /** @type {(() => unknown) | null} */
  let hostStop = null

  const runAllStops = async () => {
    const children = childStops.splice(0)
    const results = []
    for (const child of children) {
      results.push(await Promise.resolve(typeof child === 'function' ? child() : undefined))
    }
    if (typeof hostStop === 'function') {
      results.push(await Promise.resolve(hostStop()))
    }
    return results
  }

  const ctx = {
    connection,
    webServer: {
      register(entry) {
        routes.push(entry)
        return () => {
          const i = routes.indexOf(entry)
          if (i >= 0) routes.splice(i, 1)
        }
      },
    },
    tools: {
      register(def) {
        tools.push(def)
        return () => {}
      },
    },
    effect(factory) {
      hostStop = factory()
      ctx._stop = runAllStops
    },
    /**
     * Cordis-like optional inject: call fn when deps are present on ctx.
     * Child scopes get their own effect list so webServer leave can unmount compat
     * without disposing the Host fiber.
     * @param {string[]} deps
     * @param {(scope: any) => void} fn
     */
    inject(deps, fn) {
      if (!Array.isArray(deps) || typeof fn !== 'function') return
      if (!deps.every((name) => ctx[name] != null)) return
      const child = {
        ...ctx,
        effect(childFactory) {
          const stop = childFactory()
          if (typeof stop === 'function') childStops.push(stop)
        },
      }
      fn(child)
    },
    ...overrides,
  }
  return {
    ctx,
    routes,
    tools,
    stop: () => {
      if (typeof ctx._stop === 'function') return ctx._stop()
      if (childStops.length === 0 && hostStop == null) return undefined
      return runAllStops()
    },
    /** Simulate webServer fiber leaving while Host stays alive. */
    stopWebInjects: async () => {
      const children = childStops.splice(0)
      await Promise.all(children.map((child) => Promise.resolve(child())))
    },
  }
}

// ---------------------------------------------------------------------------
// HTTP 层 fake（宿主路由测试）
// ---------------------------------------------------------------------------

/** 与浏览器同源的默认请求头。 */
export const CAPABILITY_HEADERS = Object.freeze({
  origin: 'http://127.0.0.1:3080',
  'content-type': 'application/json',
})

/**
 * 带上一次性 bridge capability 的请求头。
 * @param {Record<string, any>} [extra]
 */
export function capabilityHeaders(extra = CAPABILITY_HEADERS) {
  return { ...extra, 'x-dsh-vision-capability': _internal.issueBridgeCapability() }
}

/**
 * 伪造一个 HTTP 请求（Readable 流 + method/headers/socket）。
 * @param {string} method
 * @param {Record<string, any>} [headers]
 * @param {string} [body]
 * @param {string} [addr]
 */
export function fakeRequest(method, headers, body, addr = '127.0.0.1') {
  const stream = Readable.from([body ? Buffer.from(body) : Buffer.alloc(0)])
  // @ts-expect-error 测试用最小请求对象
  stream.method = method
  // @ts-expect-error 同上
  stream.headers = headers || {}
  // @ts-expect-error 同上
  stream.socket = { remoteAddress: addr }
  return stream
}

/** 伪造一个 HTTP 响应，记录 status 与 body。 */
export function fakeResponse() {
  const box = { status: 0, body: '' }
  box.res = {
    writeHead(code) {
      box.status = code
    },
    end(text) {
      box.body = text
    },
  }
  return box
}

// ---------------------------------------------------------------------------
// 进程内派发
// ---------------------------------------------------------------------------

/**
 * 进程内 RPC 路由器。`deps` 透传给 `createVisionRpcRouter`（`getHome` 由 `home` 提供），
 * 用于注入 `debugRuntime` / `verifyCommandService` / `telemetryReader` 等。
 *
 * `dispatchAs(sessionId, …)` 把会话身份写进 payload——跨会话调用的统一写法。
 *
 * @param {string} home
 * @param {Record<string, any>} [deps]
 */
export function createRouter(home, deps = {}) {
  const router = createVisionRpcRouter({ getHome: () => home, ...deps })
  return {
    router,
    dispatch: router.dispatch,
    dispatchAs: (sessionId, endpoint, payload, signal) =>
      router.dispatch(endpoint, { ...(payload || {}), sessionId }, signal),
  }
}
