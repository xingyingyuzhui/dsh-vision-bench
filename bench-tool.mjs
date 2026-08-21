import { keilBuild, keilMap, listDir, modbusRead, pickModbusPatch } from './bench-actions.mjs'
import { requireKeilProject, requireWorkspaceCwd } from './bench-paths.mjs'
import { compactSegments, compactValues } from './bench-points.mjs'
import { compactDevices } from './bench-devices.mjs'
import { journalView, loadWorkspace, saveWorkspace } from './bench-store.mjs'

const ACTIONS = new Set(['status', 'ls', 'select', 'build', 'read', 'map'])

export const cwdOf = (agent) => {
  const session = agent && agent.session
  const header = session && session.header
  return header && header.cwd ? String(header.cwd) : ''
}

export const sessionIdOf = (agent) => {
  const session = agent && agent.session
  const header = session && session.header
  if (header && header.id) return String(header.id)
  if (session && session.id) return String(session.id)
  return ''
}

const originFrom = (input) => ({
  source: input && input.source === 'agent' ? 'agent' : 'user',
  sessionId: input && input.sessionId ? String(input.sessionId) : '',
})

const compactProjectMap = (details) => {
  const src = details && typeof details === 'object' ? details : {}
  const groups = Array.isArray(src.groups) ? src.groups : []
  return {
    project: src.project || '',
    target: src.target || '',
    defines: Array.isArray(src.defines) ? src.defines.slice(0, 80) : [],
    includes: (Array.isArray(src.includes) ? src.includes : []).slice(0, 80).map((item) => ({
      path: item && item.path ? item.path : '',
      exists: !!(item && item.exists),
      inside: !!(item && item.inside),
    })),
    groups: groups.map((group) => ({
      name: group && group.name ? group.name : '',
      files: (group && Array.isArray(group.files) ? group.files : []).map((file) => ({
        name: file && file.name ? file.name : '',
        kind: file && file.kind ? file.kind : 'other',
        rel: file && file.rel ? file.rel : '',
        exists: !!(file && file.exists),
        readable: !!(file && file.readable),
        inside: !!(file && file.inside),
        functions: (file && Array.isArray(file.functions) ? file.functions : []).slice(0, 40).map((fn) => ({
          name: fn && fn.name ? fn.name : '',
          line: fn && fn.line ? fn.line : 0,
        })),
      })),
    })),
    include_edges: (Array.isArray(src.include_edges) ? src.include_edges : []).slice(0, 200).map((edge) => ({
      from: edge && edge.from ? edge.from : '',
      name: edge && edge.name ? edge.name : '',
      to: edge && edge.to ? edge.to : '',
      resolved: !!(edge && edge.resolved),
    })),
    truncated: src.truncated && typeof src.truncated === 'object' ? src.truncated : {},
    limits: src.limits && typeof src.limits === 'object' ? src.limits : {},
    counts: src.counts && typeof src.counts === 'object' ? src.counts : {},
  }
}

const compactLog = (log) => {
  if (!Array.isArray(log)) return []
  return log.slice(0, 8).map((item) => ({
    at: item.at,
    ok: item.ok,
    action: item.action,
    summary: item.summary,
  }))
}

export async function runVisionBench(home, args, cwd, originInput, opts) {
  const action = args && args.action
  if (!ACTIONS.has(action)) {
    return { ok: false, error: 'action 必须是 status | ls | select | build | read | map' }
  }
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, action, error: room.error }
  const origin = originFrom(originInput)
  const signal = opts && opts.signal
  if (signal && signal.aborted) return { ok: false, action, cancelled: true, error: '已取消' }

  if (action === 'status') {
    const workspace = loadWorkspace(home, room.cwd)
    const journal = journalView(workspace)
    return {
      ok: true,
      action,
      cwd: room.cwd,
      keil: workspace.keil,
      modbus: {
        mode: workspace.modbus.mode,
        port: workspace.modbus.port,
        host: workspace.modbus.host,
        tcpPort: workspace.modbus.tcpPort,
        slave: workspace.modbus.slave,
        segments: compactSegments(workspace.modbus.segments),
        values: compactValues(workspace.modbus.values),
        polling: workspace.modbus.polling,
        devices: compactDevices(workspace.modbus),
        activeId: workspace.modbus.activeId,
      },
      log: compactLog(workspace.log),
      tasks: journal.tasks,
      running: journal.running,
      timeline: journal.timeline,
    }
  }

  if (action === 'ls') {
    return { ok: true, action, ...(await Promise.resolve(listDir(room.cwd, args.path))) }
  }

  if (action === 'select') {
    const keil = requireKeilProject(room.cwd, typeof args.path === 'string' ? args.path.trim() : '')
    if (keil.error) return { ok: false, action, error: keil.error }
    const saved = saveWorkspace(home, room.cwd, {
      keil: { project: keil.project, target: typeof args.target === 'string' ? args.target : '' },
      origin,
    })
    if (!saved.ok) return { ok: false, action, error: saved.error }
    return { ok: true, action, keil: saved.workspace.keil, source: origin.source }
  }

  if (action === 'map') {
    const ran = await keilMap(home, room.cwd, args.path, args.target, { signal })
    if (!ran.ok) return { action, ...ran }
    return { ok: true, action, map: compactProjectMap(ran.result && ran.result.details) }
  }

  if (action === 'build') {
    const ran = await keilBuild(home, room.cwd, {
      project: args.path,
      target: args.target,
      artifact: args.artifact,
      source: origin.source,
      sessionId: origin.sessionId,
    }, { signal })
    return { action, ...ran }
  }

  const table = args.address == null && args.function == null
  const ran = await modbusRead(home, room.cwd, {
    source: origin.source,
    sessionId: origin.sessionId,
    all: table,
    modbus: table ? undefined : pickModbusPatch({
      mode: args.mode,
      port: args.port,
      host: args.host,
      slave: args.slave,
      function: args.function,
      address: args.address,
      count: args.count,
    }),
  }, { signal })
  return { action, ...ran }
}

export function visionBenchTool(home) {
  return {
    name: 'vision_bench',
    description:
      'Vision 台架快速接口。查询或操作当前会话工作区的调试/上位机现场。'
      + 'status：已选工程、Target、点表段、最近值和任务时间线；'
      + 'ls：列出工作区内目录与 .uvprojx；'
      + 'select：选定工程（path 必填）；'
      + 'build：按已选或参数中的工程编译（同一类型同时只能有一个任务）；'
      + 'map：当前 Target 的组、源文件、包含路径、宏和函数名；truncated 为真时结果不完整，按组或文件再查；'
      + 'read：不传 address/function 则按点表整段读；传入则单次读。'
      + '先 status，再 map，不要猜测工程路径或点表。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'ls', 'select', 'build', 'read', 'map'],
          description: 'status | ls | select | build | read | map',
        },
        path: { type: 'string', description: 'ls 的目录或 select/build/map 的工程绝对路径' },
        target: { type: 'string', description: 'Keil Target' },
        artifact: { type: 'string', enum: ['hex', 'bin', 'axf', 'elf'] },
        mode: { type: 'string', enum: ['rtu', 'tcp'] },
        port: { type: 'string' },
        host: { type: 'string' },
        slave: { type: 'number' },
        function: { type: 'number' },
        address: { type: 'number' },
        count: { type: 'number' },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(_args, value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 620000,
    async execute(args, exec) {
      const agent = exec && exec.agent
      const signal = exec && exec.signal
      if (signal && signal.aborted) return { ok: false, cancelled: true, error: '已取消' }
      return runVisionBench(home, args || {}, cwdOf(agent), {
        source: 'agent',
        sessionId: sessionIdOf(agent),
      }, { signal })
    },
  }
}

export const _internal = { ACTIONS, compactLog, originFrom }
