import { keilBuild, keilMap, keilScan, keilTargets, listDir, modbusPoll, modbusRead } from './bench-actions.mjs'
import { seedVisionBenchPreset } from './bench-preset.mjs'
import {
  defaultDshHome,
  journalView,
  loadBindings,
  loadWorkspace,
  probeBindings,
  saveBindings,
  saveWorkspace,
  sweepStaleTasks,
} from './bench-store.mjs'
import { requireWorkspaceCwd } from './bench-paths.mjs'
import { cwdOf, visionBenchTool } from './bench-tool.mjs'
import { stopAllSlaves, syncDeviceSlaves, withListenRuntime } from './bench-slave.mjs'
import { listSerialPorts } from './bench-serial.mjs'

export const name = 'dsh-vision-bench'
export const inject = ['webServer', 'tools', 'agentPresets']

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

const syncSlaves = async (cwd) => {
  if (!cwd) return
  try {
    const ws = loadWorkspace(dshHome, cwd)
    await syncDeviceSlaves(cwd, ws.modbus, () => loadWorkspace(dshHome, cwd).modbus)
  } catch { /* listen is best-effort */ }
}

const snapshot = async (cwd) => {
  const bindings = loadBindings(dshHome)
  const body = { ok: true, bindings, health: probeBindings(bindings) }
  const room = cwd ? requireWorkspaceCwd(cwd) : { error: 'no-cwd' }
  if (!room.error) {
    await syncSlaves(room.cwd)
    const workspace = loadWorkspace(dshHome, room.cwd)
    body.workspace = withListenRuntime(room.cwd, workspace)
    body.journal = journalView(body.workspace)
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
    ctx.effect(() => () => {
      if (typeof stopTool === 'function') stopTool()
    })
    return
  }
  try {
    sweepStaleTasks(dshHome)
  } catch { /* sweep is best-effort */ }
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
      if (!saved.ok) return saved
      await syncSlaves(room.cwd)
      const workspace = withListenRuntime(room.cwd, saved.workspace)
      return { ok: true, workspace, journal: journalView(workspace) }
    }),
    route('/dsh-vision-bench/fs/list', async (req) => {
      const body = await readJsonBody(req)
      return listDir(body && body.cwd, body && body.path)
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
      return keilBuild(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/modbus/read', async (req) => {
      const body = await readJsonBody(req)
      return modbusRead(dshHome, body && body.cwd, body)
    }),
    route('/dsh-vision-bench/modbus/poll', async (req) => {
      const body = await readJsonBody(req)
      const ran = await modbusPoll(dshHome, body && body.cwd)
      await syncSlaves(body && body.cwd)
      return ran
    }),
    route('/dsh-vision-bench/serial/ports', async () => listSerialPorts()),
  ]
  const disposers = rows.map((entry) => ctx.webServer.register(entry))
  void seedVisionBenchPreset(ctx.agentPresets, dshHome).catch(() => { /* roster copy is best-effort */ })
  ctx.effect(() => () => {
    for (const dispose of disposers) dispose()
    stopAllSlaves()
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
