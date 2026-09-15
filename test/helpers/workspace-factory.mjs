// @ts-check
/**
 * P1-1：workspace / session 测试工厂。
 *
 * 抽取前 `test/` 下有 188 处 `mkdtemp(join(tmpdir(), ...))`，散落在 66 个文件里，
 * 各自重复实现「建 home → 建 cwd → saveWorkspace → 清理」这四件事。重复本身不是
 * 最糟的部分：`hmi-connection-state.test.mjs` 一类文件把 `await rm(home, ...)`
 * 写在测试体末尾而不是 `finally`，断言一失败临时目录就留在 /tmp 里。
 *
 * 本模块把生命周期交给 `node:test` 的 `t.after()`，因此**断言失败也会回收**。
 *
 * 用法：
 *
 * ```js
 * test('单会话', async (t) => {
 *   const bench = await createBench(t, { shared: { connections: [connection('c1', 'rtu', 'COM3')] } })
 *   bench.save({ modbus: { sim: true } })
 *   assert.equal(bench.modbus().sim, true)
 * })
 * ```
 *
 * 放置位置说明：`test/helpers/` 下的文件既不会被 `run-tests.mjs` 当成测试
 * （只收 `*.test.mjs`），也不进结构预算、不进源码断言审计、不随包发布——
 * 这正是基础设施该待的位置。
 *
 * 本模块只负责「搭场景」，不负责断言，也不改变任何生产语义。
 */

import { existsSync, mkdirSync, rmSync } from 'node:fs'
import { mkdir, mkdtemp, readFile, rm, writeFile } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { projectModbusForSession } from '../../src/application/modbus/config-scope-service.mjs'
import { saveSessionModbusPatch } from '../../src/application/modbus/workspace-session-view.mjs'

/** @type {Set<string>} */
const pendingDirs = new Set()
let exitHookInstalled = false

/**
 * Fallback reclamation for callers that pass no test context. Synchronous,
 * best-effort, only ever runs at process shutdown.
 */
function ensureExitHook() {
  if (exitHookInstalled) return
  exitHookInstalled = true
  process.on('exit', () => {
    for (const dir of pendingDirs) {
      try {
        rmSync(dir, { recursive: true, force: true })
      } catch {
        /* best effort during shutdown */
      }
    }
    pendingDirs.clear()
  })
}

/**
 * Register a temp directory for reclamation and return an idempotent releaser.
 *
 * @param {any} t node:test context (optional)
 * @param {string} dir
 * @returns {() => Promise<void>}
 */
function track(t, dir) {
  pendingDirs.add(dir)
  let released = false
  const release = async () => {
    if (released) return
    released = true
    pendingDirs.delete(dir)
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
  if (t && typeof t.after === 'function') t.after(release)
  else ensureExitHook()
  return release
}

/**
 * A bare temporary directory, for scenarios that need no home/cwd workspace
 * (preset overlays, keil fixture roots, scanner roots …).
 *
 * @param {any} [t] node:test context; cleanup is registered on it when present
 * @param {string} [prefix]
 * @returns {Promise<string>}
 */
export async function createTempDir(t, prefix = 'dvb-') {
  const dir = await mkdtemp(join(tmpdir(), prefix))
  track(t, dir)
  return dir
}

/**
 * Build a connection row with the defaults every test file was hand-rolling.
 *
 * @param {string} id
 * @param {'rtu' | 'tcp'} [mode]
 * @param {string} [port] serial device path; ignored for tcp
 * @param {Record<string, any>} [overrides] merged into `conn`
 */
export function connection(id, mode = 'tcp', port = '', overrides = {}) {
  return {
    id,
    name: id,
    role: 'client',
    enabled: true,
    conn: {
      mode,
      port,
      host: mode === 'tcp' ? '127.0.0.1' : '',
      tcpPort: 502,
      baudrate: 9600,
      slave: 1,
      ...overrides,
    },
  }
}

/**
 * A contiguous holding-register point series starting at address 0.
 *
 * @param {string} namePrefix
 * @param {number} count
 * @param {Record<string, any>} [extra] merged into every point
 */
export function pointSeries(namePrefix, count, extra = {}) {
  return Array.from({ length: count }, (_, i) => ({
    name: namePrefix + i,
    function: 3,
    address: i,
    ...extra,
  }))
}

/**
 * Fill in the three topology arrays a session config always needs, so a
 * missing slice can never be silently `undefined`.
 *
 * @param {Record<string, any>} input
 */
function normalizeTopology(input) {
  const { connections = [], devices = [], points = [], ...rest } = input
  return { connections, devices, points, ...rest }
}

/**
 * @param {{ shared?: any, sessions?: any, modbus?: any, workspace?: any }} parts
 */
function buildWorkspacePatch({ shared, sessions, modbus, workspace }) {
  /** @type {Record<string, any>} */
  const modbusPatch = {}
  if (shared) Object.assign(modbusPatch, normalizeTopology(shared))
  if (sessions) {
    modbusPatch.sessionConfigs = Object.fromEntries(
      Object.entries(sessions).map(([id, cfg]) => [id, normalizeTopology(cfg || {})]),
    )
  }
  if (modbus) Object.assign(modbusPatch, modbus)

  /** @type {Record<string, any>} */
  const patch = { ...(workspace || {}) }
  if (Object.keys(modbusPatch).length > 0) patch.modbus = { version: 3, ...modbusPatch }
  return Object.keys(patch).length > 0 ? patch : null
}

/**
 * @param {string} home
 * @param {string} cwd
 * @param {() => Promise<void>} release
 */
function createHandle(home, cwd, release) {
  return {
    home,
    cwd,
    /** Absolute path inside the workspace cwd. */
    at: (...segments) => join(cwd, ...segments),
    /** Patch-merge into the workspace on disk (same semantics as `saveWorkspace`). */
    save: (/** @type {any} */ patch) => saveWorkspace(home, cwd, patch),
    load: () => loadWorkspace(home, cwd),
    modbus: () => loadWorkspace(home, cwd).modbus,
    /** Effective flat modbus for one session (sessionConfigs projected away). */
    session: (/** @type {string} */ sessionId) => projectModbusForSession(loadWorkspace(home, cwd).modbus, sessionId),
    /**
     * Simulate an out-of-band edit to one session's topology — the
     * "配置漂移" scenario (endpoint drift / configVersion drift).
     */
    drift: (/** @type {string} */ sessionId, /** @type {any} */ modbusPatch) =>
      saveSessionModbusPatch(home, cwd, sessionId, { modbus: modbusPatch }),
    write: (/** @type {string} */ relPath, /** @type {string} */ text) => writeFile(join(cwd, relPath), text),
    read: (/** @type {string} */ relPath) => readFile(join(cwd, relPath), 'utf8'),
    mkdir: (/** @type {string} */ relPath) => mkdir(join(cwd, relPath), { recursive: true }).then(() => {}),
    exists: (/** @type {string} */ relPath) => existsSync(join(cwd, relPath)),
    /** Release the temp tree early; safe to call more than once. */
    cleanup: release,
    /**
     * 把这个 home 设为进程级 DSH home。
     *
     * 注意 `host.js` 的 `apply(ctx)` 会把它重置回默认 home（host.js:164），
     * 所以**宿主测试必须在 `apply` 之后再调用一次**，否则被测代码会去读
     * 真实用户的 home，断言看起来随机失败。
     */
    useAsDshHome: async () => {
      const { _internal } = await import('../../host.js')
      _internal.setDshHome(home)
      return home
    },
  }
}

/**
 * Register a path that lives **outside** the temp home for the same
 * reclamation as the temp tree. Production code sometimes writes siblings —
 * `ensurePresetOverlay` puts its backup in `dirname(dir)`, i.e. straight into
 * `tmpdir()` — and those would otherwise survive the test. Accepts a falsy
 * value so callers can pass an optional path unconditionally.
 *
 * @param {any} t node:test context
 * @param {string | null | undefined} target
 */
export function trackPath(t, target) {
  if (!target) return
  track(t, target)
}

/**
 * Create an isolated home + workspace project directory for one test.
 *
 * Scenarios covered (see P1-1 acceptance):
 *  - 单会话：`{ sessions: { 'session-a': { connections: [...] } } }`
 *  - 双会话：`{ sessions: { a: {...}, b: {...} } }`
 *  - 多连接：`{ shared: { connections: [connection('c1'), connection('c2')] } }`
 *  - 配置漂移：先写 `shared`/`sessions`，再用 `bench.drift(sessionId, patch)`
 *
 * @param {any} t node:test context; pass it so cleanup runs even on failure
 * @param {{
 *   prefix?: string,
 *   project?: string | null,
 *   shared?: Record<string, any>,
 *   sessions?: Record<string, Record<string, any>>,
 *   modbus?: Record<string, any>,
 *   workspace?: Record<string, any>,
 *   dshHome?: boolean,
 * }} [options]
 */
export async function createBench(t, options = {}) {
  const { prefix = 'dvb-', project = 'board', shared, sessions, modbus, workspace, dshHome = false } = options

  const home = await mkdtemp(join(tmpdir(), prefix))
  // Track before anything else can throw, so a failed setup still gets reclaimed.
  const release = track(t, home)

  const cwd = project ? join(home, project) : home
  if (project) mkdirSync(cwd, { recursive: true })

  if (dshHome) {
    const { _internal } = await import('../../host.js')
    _internal.setDshHome(home)
  }

  const bench = createHandle(home, cwd, release)
  const patch = buildWorkspacePatch({ shared, sessions, modbus, workspace })
  if (patch) bench.save(patch)
  return bench
}
