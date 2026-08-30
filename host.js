import {
  connectOp,
  keilBuild,
  keilMap,
  keilScan,
  keilTargets,
  listDir,
  listFrames,
  listPendingWrites,
  modbusPoll,
  modbusRead,
  modbusWrite,
  openocdDownload,
  pointsOp,
  requestFocus,
  resolvePendingWrite,
} from './bench-actions.mjs'
import { runSelfCheck } from './bench-check.mjs'
import { normalizeModbus } from './bench-devices.mjs'
import { artifactInfo, readBuildLog, readProjectFile } from './bench-fs.mjs'
import { getVisionIoBroker, stopVisionIoBroker } from './bench-io-broker.mjs'
import { toEndpoint } from './bench-io-contract.mjs'
import { changedConnectionIds, notifyConnectionRelease } from './bench-modbus-transport.mjs'
import { migrateLegacyDisabled } from './bench-modbus.mjs'
import { maybeNotifyResult, notifyBenchEvent, setAgentsRegistry } from './bench-notify.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { ensurePolling, pollingStatus, startPolling, stopAllPolling, stopPolling } from './bench-polling-service.mjs'
import { seedVisionBenchPreset } from './bench-preset.mjs'
import { VISION_GUIDANCE } from './bench-preset.mjs'
import {
  clearSerialMonitorState,
  closeConnectionLink,
  feedConnectionFrames,
  listConnectedSerialSources,
  listConnectionStates,
  openConnectionLink,
} from './bench-serial-monitor.mjs'
import { listSerialPorts } from './bench-serial.mjs'
import {
  appendEvidence,
  createManualRequest,
  defaultDshHome,
  journalView,
  loadBindings,
  loadWorkspace,
  patchPointFlags,
  probeBindings,
  resolveManualRequest,
  saveBindings,
  saveWorkspaceAsync,
  sweepStaleTasks,
  touchServiceSession,
} from './bench-store.mjs'
import { clearFramesByConnection } from './bench-store.mjs'
import { cwdOf, visionBenchTool } from './bench-tool.mjs'
import { registerVisionHost } from './src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher, handleCommand } from './src/interfaces/http/vision-command-routes.mjs'

export const name = 'dsh-vision-bench'
export const inject = ['webServer', 'tools', 'agentPresets', 'systemPrompt']

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
const CSRF = 'x-dsh-vision-bench'
const WORKSPACE_CONFIG_KEYS = new Set(['conn', 'connections', 'devices', 'points', 'visualization'])

let dshHome = defaultDshHome()

const writeJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const readJsonBody = (req, cap = BODY_CAP) =>
  new Promise((resolveBody, reject) => {
    let size = 0
    const chunks = []
    req.on('data', (chunk) => {
      size += chunk.length
      if (size > cap) {
        reject(new Error('body too large'))
        req.destroy()
        return
      }
      chunks.push(chunk)
    })
    req.on('end', () => {
      try {
        const text = Buffer.concat(chunks).toString('utf8').trim()
        resolveBody(text.length === 0 ? {} : JSON.parse(text))
      } catch {
        reject(new Error('invalid json body'))
      }
    })
    req.on('error', reject)
  })

/** 带 sessionId 的请求自动归属当前 Session（后台告警通知目标）。 */
const readBodyAndTouchSession = async (req) => {
  const body = await readJsonBody(req)
  const action = body && (body.action || body.payload?.action)
  if (action !== 'system.ping' && body && body.cwd && body.sessionId) {
    await touchServiceSession(dshHome, body.cwd, body.sessionId)
  }
  return body
}

const guard = (req, res) => {
  if (req.method !== 'POST') {
    writeJson(res, 405, { ok: false, error: 'method not allowed' })
    return false
  }
  const headers = req.headers || {}
  if (headers[CSRF] !== '1' && headers['X-DSH-Vision-Bench'] !== '1') {
    writeJson(res, 403, { ok: false, error: 'missing csrf header' })
    return false
  }
  const origin = headers.origin || headers.Origin
  if (origin && !LOOPBACK_ORIGIN.test(origin)) {
    writeJson(res, 403, { ok: false, error: 'origin not allowed' })
    return false
  }
  return true
}

const snapshot = async (cwd) => {
  const bindings = loadBindings(dshHome)
  const body = {
    ok: true,
    bindings,
    health: probeBindings(bindings),
    ioRuntime: getVisionIoBroker().snapshot(),
  }
  const room = cwd ? requireWorkspaceCwd(cwd) : { error: 'no-cwd' }
  if (!room.error) {
    // Task1/0.19.3: 旧版 enabled 禁用态 → 停止该连接自动采集并清理字段（一次性迁移）
    try {
      await migrateLegacyDisabled(dshHome, room.cwd)
    } catch {
      /* 迁移尽力而为 */
    }
    // Task2/0.19.3: Host 后台采集协调器按需续跑
    try {
      ensurePolling(dshHome, room.cwd)
    } catch {
      /* 采集尽力而为 */
    }
    const workspace = loadWorkspace(dshHome, room.cwd)
    body.workspace = workspace
    body.journal = journalView(body.workspace)
    body.pendingWrites = listPendingWrites(room.cwd)
    const sources = await listConnectedSerialSources(dshHome, room.cwd)
    body.serialSources = sources.sources || []
    const states = await listConnectionStates(dshHome, room.cwd)
    body.connectionStates = states.connectionStates || []
  }
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

const normalizeConnAlias = (body) => {
  if (!body || typeof body !== 'object') return body
  if (body.connId && !body.connectionId) body.connectionId = body.connId
  if (body.connectionId && !body.connId) body.connId = body.connectionId
  // normalize points array alias inside pointsOp body
  if (Array.isArray(body.points)) {
    for (const p of body.points) {
      if (p && typeof p === 'object') {
        if (p.connId && !p.connectionId) p.connectionId = p.connId
        if (p.connectionId && !p.connId) p.connId = p.connectionId
      }
    }
  }
  if (body.point && typeof body.point === 'object') {
    const p = body.point
    if (p.connId && !p.connectionId) p.connectionId = p.connId
    if (p.connectionId && !p.connId) p.connId = p.connectionId
  }
  return body
}

const route = (path, fn) => ({
  kind: 'exact',
  path,
  handler: (req, res) => {
    if (!guard(req, res)) return
    respond(req, res, () => fn(req))
  },
})

export function apply(ctx, config = {}) {
  dshHome = defaultDshHome()
  const role = config.role === 'agent' ? 'agent' : 'host'
  if (role === 'agent') {
    const stopTool = ctx.tools.register(visionBenchTool(dshHome))
    let stopGuidance = () => {}
    try {
      if (ctx.systemPrompt && typeof ctx.systemPrompt.section === 'function') {
        stopGuidance =
          ctx.systemPrompt.section({
            name: 'vision-bench:guidance',
            order: 20,
            text: () => VISION_GUIDANCE,
          }) || (() => {})
      }
    } catch {}
    ctx.effect(() => () => {
      if (typeof stopTool === 'function') stopTool()
      if (typeof stopGuidance === 'function') stopGuidance()
    })
    return
  }
  void sweepStaleTasks(dshHome).catch(() => {})
  // Lazy resolver: the agents service may register after this plugin applies.
  try {
    setAgentsRegistry(() => (ctx.get ? ctx.get('agents') : null))
  } catch {
    /* agent registry is optional */
  }
  const commandDispatcher = createVisionCommandDispatcher(dshHome)
  const stopHost = registerVisionHost(commandDispatcher)
  const rows = [
    route('/dsh-vision-bench/state', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return snapshot(body && body.cwd)
    }),
    route('/dsh-vision-bench/bindings', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const saved = saveBindings(dshHome, body && body.bindings)
      if (!saved.ok) return saved
      return { ok: true, bindings: saved.bindings, health: probeBindings(saved.bindings) }
    }),
    route('/dsh-vision-bench/workspace', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const modbus = body && body.modbus
      if (modbus && Object.keys(modbus).some((key) => WORKSPACE_CONFIG_KEYS.has(key))) {
        return {
          ok: false,
          errorCode: 'CONFIG_COMMAND_REQUIRED',
          error: '连接、设备、点位与可视化配置必须使用增量配置命令',
        }
      }
      const prev = loadWorkspace(dshHome, room.cwd)
      const saved = await saveWorkspaceAsync(dshHome, room.cwd, {
        keil: body && body.keil,
        modbus: body && body.modbus,
      })
      if (!saved.ok) return { ok: false, error: saved.error, workspace: saved.workspace }
      notifyConnectionRelease(room.cwd, changedConnectionIds(prev.modbus, saved.workspace.modbus))
      return { ok: true, workspace: saved.workspace, journal: journalView(saved.workspace) }
    }),
    route('/dsh-vision-bench/fs/list', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return listDir(body && body.cwd, body && body.path)
    }),
    route('/dsh-vision-bench/project/file', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = body && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
      if (room.error) return { ok: false, error: room.error }
      return readProjectFile(room.cwd, body && (body.path || body.file))
    }),
    route('/dsh-vision-bench/keil/log', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return readBuildLog(dshHome, body && body.logFile)
    }),
    route('/dsh-vision-bench/keil/artifact', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return artifactInfo(body && body.cwd, body && body.path)
    }),
    route('/dsh-vision-bench/keil/download', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const ran = await openocdDownload(dshHome, body && body.cwd, body)
      if (ran && !ran.needsConfirm) maybeNotifyResult(dshHome, body && body.cwd, '烧录', ran)
      return ran
    }),
    route('/dsh-vision-bench/keil/scan', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return keilScan(dshHome, body && body.cwd)
    }),
    route('/dsh-vision-bench/keil/targets', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return keilTargets(dshHome, body && body.cwd, body && body.project)
    }),
    route('/dsh-vision-bench/keil/map', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return keilMap(dshHome, body && body.cwd, body && body.project, body && body.target)
    }),
    route('/dsh-vision-bench/keil/build', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const ran = await keilBuild(dshHome, body && body.cwd, body)
      maybeNotifyResult(dshHome, body && body.cwd, '编译', ran)
      return ran
    }),
    route('/dsh-vision-bench/modbus/read', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      return modbusRead(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/modbus/write', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      const ran = await modbusWrite(dshHome, body && body.cwd, body)
      maybeNotifyResult(dshHome, body && body.cwd, '写点', ran)
      return ran
    }),
    route('/dsh-vision-bench/modbus/write/approve', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const ran = await resolvePendingWrite(dshHome, room.cwd, body && body.id, (body && body.approved) === true)
      maybeNotifyResult(dshHome, room.cwd, '写点', ran)
      return ran
    }),
    route('/dsh-vision-bench/modbus/connect', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      return connectOp(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/modbus/points', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      return pointsOp(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/points/flags', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const patch = {}
      if (typeof (body && body.monitorEnabled) === 'boolean') patch.monitorEnabled = body.monitorEnabled
      if (typeof (body && body.alarmEnabled) === 'boolean') patch.alarmEnabled = body.alarmEnabled
      return patchPointFlags(dshHome, room.cwd, body && body.pointId, patch, {
        expectedConfigVersion: body && body.expectedConfigVersion,
      })
    }),
    route('/dsh-vision-bench/frames/list', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      return listFrames(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/frames/clear', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      // Task1/0.18.2: dedicated explicit-delete storage op (NOT merge)
      return clearFramesByConnection(dshHome, room.cwd, {
        connectionId: body && body.connectionId,
        all: body && body.all === true,
      })
    }),
    route('/dsh-vision-bench/focus', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      return requestFocus(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/evidence', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const ev = body && (body.evidence || body.evidences || body.item)
      const list = Array.isArray(ev) ? ev : ev ? [ev] : []
      if (!list.length) return { ok: false, error: '缺少 evidence' }
      return appendEvidence(dshHome, room.cwd, list)
    }),
    route('/dsh-vision-bench/manual/resolve', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const ran = await resolveManualRequest(dshHome, room.cwd, body && body.id, body && body.done !== false)
      if (ran.ok && ran.request) {
        void notifyBenchEvent(
          dshHome,
          room.cwd,
          '人工操作' + (ran.request.status === 'done' ? '已完成' : '无法完成') + '：' + ran.request.text,
          '',
          { sessionId: ran.request.sessionId },
        ).catch(() => {})
      }
      return ran
    }),
    route('/dsh-vision-bench/modbus/poll', async (req) => {
      const body = normalizeConnAlias(await readBodyAndTouchSession(req))
      return modbusPoll(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/polling/start', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = body && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
      if (room.error) return { ok: false, error: room.error }
      return startPolling(dshHome, room.cwd, body)
    }),
    route('/dsh-vision-bench/polling/stop', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = body && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
      if (room.error) return { ok: false, error: room.error }
      return stopPolling(dshHome, room.cwd, body)
    }),
    route('/dsh-vision-bench/polling/status', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = body && body.cwd ? requireWorkspaceCwd(body.cwd) : { error: 'no-cwd' }
      if (room.error) return { ok: false, error: room.error }
      return pollingStatus(dshHome, room.cwd)
    }),
    route('/dsh-vision-bench/connection/open', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const pack = normalizeModbus(loadWorkspace(dshHome, room.cwd).modbus)
      const conn = pack.connections.find((c) => c.id === (body.connectionId || body.connId))
      if (!conn) return { ok: false, error: '连接不存在' }
      if (conn.conn && conn.conn.sim) return { ok: true, skipped: true, simulated: true }
      return openConnectionLink(room.cwd, { connectionId: conn.id, endpoint: toEndpoint(conn) })
    }),
    route('/dsh-vision-bench/connection/close', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      return closeConnectionLink(room.cwd, body.connectionId || body.connId)
    }),
    route('/dsh-vision-bench/serial/ports', async () => listSerialPorts()),
    route('/dsh-vision-bench/serial/sources', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      return listConnectedSerialSources(dshHome, room.cwd)
    }),
    route('/dsh-vision-bench/selfcheck', async (req) => {
      const body = await readBodyAndTouchSession(req)
      return runSelfCheck(dshHome, body && body.cwd)
    }),
    route('/dsh-vision-bench/serial/feed', async (req) => {
      const body = await readBodyAndTouchSession(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      return feedConnectionFrames(room.cwd, { connectionId: body.connectionId || '', since: body.since })
    }),
    route('/dsh-vision-bench/command', async (req) => handleCommand(dshHome, req, readBodyAndTouchSession)),
  ]
  const disposers = rows.map((entry) => ctx.webServer.register(entry))
  void seedVisionBenchPreset(ctx.agentPresets, dshHome).catch(() => {
    /* roster copy is best-effort */
  })
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    stopHost()
    clearSerialMonitorState()
    stopAllPolling()
    void stopVisionIoBroker('plugin-dispose')
  })
}

export const _internal = {
  setDshHome(dir) {
    dshHome = dir
  },
  getDshHome() {
    return dshHome
  },
  guard,
  snapshot,
  cwdOf,
  journalView,
}
