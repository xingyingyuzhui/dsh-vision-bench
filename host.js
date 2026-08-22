import { listPendingWrites, keilBuild, keilMap, keilScan, keilTargets, listDir, listFrames, modbusPoll, modbusRead, modbusWrite, openocdDownload, requestFocus, resolvePendingWrite } from './bench-actions.mjs'
import { runSelfCheck } from './bench-check.mjs'
import { artifactInfo, readBuildLog } from './bench-fs.mjs'
import { seedVisionBenchPreset } from './bench-preset.mjs'
import {
  bindSession,
  createManualRequest,
  defaultDshHome,
  journalView,
  loadBindings,
  loadWorkspace,
  probeBindings,
  resolveManualRequest,
  saveBindings,
  saveWorkspace,
  sweepStaleTasks,
  unbindSession,
} from './bench-store.mjs'
import { maybeNotifyResult, notifyBenchEvent, setAgentsRegistry } from './bench-notify.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { cwdOf, visionBenchTool } from './bench-tool.mjs'
import { listSerialPorts } from './bench-serial.mjs'
import { closeSerialMonitor, openSerialMonitor, serialFeed, serialState, stopAllSerialMonitors } from './bench-serial-monitor.mjs'
import { VISION_GUIDANCE } from './bench-preset.mjs'

export const name = 'dsh-vision-bench'
export const inject = ['webServer', 'tools', 'agentPresets', 'systemPrompt']

const BODY_CAP = 65536
const LOOPBACK_ORIGIN = /^https?:\/\/(127\.0\.0\.1|localhost)(:\d+)?$/
const CSRF = 'x-dsh-vision-bench'

let dshHome = defaultDshHome()

const writeJson = (res, status, body) => {
  res.writeHead(status, { 'Content-Type': 'application/json; charset=utf-8', 'Cache-Control': 'no-store' })
  res.end(JSON.stringify(body))
}

const readJsonBody = (req, cap = BODY_CAP) => new Promise((resolveBody, reject) => {
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
  const body = { ok: true, bindings, health: probeBindings(bindings) }
  const room = cwd ? requireWorkspaceCwd(cwd) : { error: 'no-cwd' }
  if (!room.error) {
    const workspace = loadWorkspace(dshHome, room.cwd)
    body.workspace = workspace
    body.journal = journalView(body.workspace)
    body.pendingWrites = listPendingWrites(room.cwd)
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
        stopGuidance = ctx.systemPrompt.section({
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
  try {
    sweepStaleTasks(dshHome)
  } catch { /* sweep is best-effort */ }
  // Lazy resolver: the agents service may register after this plugin applies.
  try {
    setAgentsRegistry(() => (ctx.get ? ctx.get('agents') : null))
  } catch { /* agent registry is optional */ }
  const rows = [
    route('/dsh-vision-bench/state', async (req) => {
      const body = await readJsonBody(req)
      return snapshot(body && body.cwd)
    }),
    route('/dsh-vision-bench/bindings', async (req) => {
      const body = await readJsonBody(req)
      const saved = saveBindings(dshHome, body && body.bindings)
      if (!saved.ok) return saved
      return { ok: true, bindings: saved.bindings, health: probeBindings(saved.bindings) }
    }),
    route('/dsh-vision-bench/workspace', async (req) => {
      const body = await readJsonBody(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const saved = saveWorkspace(dshHome, room.cwd, {
        keil: body && body.keil,
        modbus: body && body.modbus,
      })
      if (!saved.ok) return { ok: false, error: saved.error, workspace: saved.workspace }
      return { ok: true, workspace: saved.workspace, journal: journalView(saved.workspace) }
    }),
    route('/dsh-vision-bench/fs/list', async (req) => {
      const body = await readJsonBody(req)
      return listDir(body && body.cwd, body && body.path)
    }),
    route('/dsh-vision-bench/keil/log', async (req) => {
      const body = await readJsonBody(req)
      return readBuildLog(dshHome, body && body.logFile)
    }),
    route('/dsh-vision-bench/keil/artifact', async (req) => {
      const body = await readJsonBody(req)
      return artifactInfo(body && body.cwd, body && body.path)
    }),
    route('/dsh-vision-bench/keil/download', async (req) => {
      const body = await readJsonBody(req)
      const ran = await openocdDownload(dshHome, body && body.cwd, body)
      if (ran && !ran.needsConfirm) maybeNotifyResult(dshHome, body && body.cwd, '烧录', ran)
      return ran
    }),
    route('/dsh-vision-bench/keil/scan', async (req) => {
      const body = await readJsonBody(req)
      return keilScan(dshHome, body && body.cwd)
    }),
    route('/dsh-vision-bench/keil/targets', async (req) => {
      const body = await readJsonBody(req)
      return keilTargets(dshHome, body && body.cwd, body && body.project)
    }),
    route('/dsh-vision-bench/keil/map', async (req) => {
      const body = await readJsonBody(req)
      return keilMap(dshHome, body && body.cwd, body && body.project, body && body.target)
    }),
    route('/dsh-vision-bench/keil/build', async (req) => {
      const body = await readJsonBody(req)
      const ran = await keilBuild(dshHome, body && body.cwd, body)
      maybeNotifyResult(dshHome, body && body.cwd, '编译', ran)
      return ran
    }),
    route('/dsh-vision-bench/modbus/read', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      return modbusRead(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/modbus/write', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      const ran = await modbusWrite(dshHome, body && body.cwd, body)
      maybeNotifyResult(dshHome, body && body.cwd, '写点', ran)
      return ran
    }),
    route('/dsh-vision-bench/modbus/write/approve', async (req) => {
      const body = await readJsonBody(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const ran = await resolvePendingWrite(dshHome, room.cwd, body && body.id, (body && body.approved) === true)
      maybeNotifyResult(dshHome, room.cwd, '写点', ran)
      return ran
    }),
    route('/dsh-vision-bench/modbus/connect', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      return connectOp(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/modbus/points', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      return pointsOp(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/frames/list', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      return listFrames(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/focus', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      return requestFocus(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/session/bind', async (req) => {
      const body = await readJsonBody(req)
      return bindSession(dshHome, body && body.cwd, body && body.sessionId)
    }),
    route('/dsh-vision-bench/session/unbind', async (req) => {
      const body = await readJsonBody(req)
      return unbindSession(dshHome, body && body.cwd)
    }),
    route('/dsh-vision-bench/manual/resolve', async (req) => {
      const body = await readJsonBody(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const ran = resolveManualRequest(dshHome, room.cwd, body && body.id, body && body.done !== false)
      if (ran.ok && ran.request) {
        void notifyBenchEvent(dshHome, room.cwd,
          '人工操作' + (ran.request.status === 'done' ? '已完成' : '无法完成') + '：' + ran.request.text,
          '', { sessionId: ran.request.sessionId }).catch(() => {})
      }
      return ran
    }),
    route('/dsh-vision-bench/modbus/poll', async (req) => {
      const body = normalizeConnAlias(await readJsonBody(req))
      return modbusPoll(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/serial/ports', async () => listSerialPorts()),
    route('/dsh-vision-bench/selfcheck', async (req) => {
      const body = await readJsonBody(req)
      return runSelfCheck(dshHome, body && body.cwd)
    }),
    route('/dsh-vision-bench/serial/open', async (req) => {
      const body = await readJsonBody(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      const bindings = loadBindings(dshHome)
      return openSerialMonitor(bindings.python, room.cwd, body || {})
    }),
    route('/dsh-vision-bench/serial/close', async (req) => {
      const body = await readJsonBody(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      return closeSerialMonitor(room.cwd)
    }),
    route('/dsh-vision-bench/serial/feed', async (req) => {
      const body = await readJsonBody(req)
      const room = requireWorkspaceCwd(body && body.cwd)
      if (room.error) return { ok: false, error: room.error }
      return serialFeed(room.cwd, body && body.since)
    }),
  ]
  const disposers = rows.map((entry) => ctx.webServer.register(entry))
  void seedVisionBenchPreset(ctx.agentPresets, dshHome).catch(() => { /* roster copy is best-effort */ })
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    stopAllSerialMonitors()
  })
}

export const _internal = {
  setDshHome(dir) { dshHome = dir },
  getDshHome() { return dshHome },
  guard,
  snapshot,
  cwdOf,
  journalView,
}
