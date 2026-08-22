import { connectOp, keilBuild, keilMap, listDir, modbusRead, modbusWrite, pointsOp } from './bench-modbus-forward.mjs'
import { requireKeilProject, requireWorkspaceCwd } from './bench-paths.mjs'
import { decodeValue } from './bench-points.mjs'
import { connLabel, normalizeModbus } from './bench-devices.mjs'
import { createManualRequest, journalView, loadWorkspace, saveWorkspace } from './bench-store.mjs'

const ACTIONS = new Set(['status', 'ls', 'select', 'build', 'read', 'write', 'map', 'manual', 'connect', 'points'])

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
    return { ok: false, error: 'action 必须是 status | ls | select | build | read | write | map | manual | connect | points' }
  }
  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, action, error: room.error }
  const origin = originFrom(originInput)
  const signal = opts && opts.signal
  if (signal && signal.aborted) return { ok: false, action, cancelled: true, error: '已取消' }

  if (action === 'status') {
    const workspace = loadWorkspace(home, room.cwd)
    const journal = journalView(workspace)
    const boundId = workspace.session && workspace.session.boundId ? workspace.session.boundId : ''
    const pack = normalizeModbus(workspace.modbus)
    return {
      ok: true,
      action,
      cwd: room.cwd,
      session: {
        boundId,
        isBound: !!boundId && boundId === origin.sessionId,
      },
      keil: workspace.keil,
      modbus: {
        version: pack.version,
        connections: pack.connections,
        devices: pack.devices,
        points: (pack.points || []).map((p) => {
          const rec = (pack.values || []).find((item) => item.key === p.id || item.pointId === p.id)
          return {
            id: p.id,
            connectionId: p.connectionId,
            connId: p.connectionId,
            deviceId: p.deviceId,
            name: p.name,
            area: p.area,
            function: p.function,
            address: p.address,
            scale: p.scale,
            offset: p.offset,
            unit: p.unit,
            alarmMin: p.alarmMin,
            alarmMax: p.alarmMax,
            writable: [1, 3].includes(p.function),
            raw: rec ? rec.raw : null,
            value: rec ? decodeValue(p, rec.raw) : null,
            ok: rec ? rec.ok : false,
            at: rec ? rec.at : 0,
          }
        }),
        values: pack.values,
        activeConnectionId: pack.activeConnectionId,
        activeDeviceId: pack.activeDeviceId,
        pollingByConnection: pack.pollingByConnection,
        framesByConnection: pack.framesByConnection,
        polling: pack.polling,
        alarmState: pack.alarmState,
        alarmActive: pack.alarmActive,
        conn: {
          mode: pack.conn.mode,
          port: pack.conn.port,
          baudrate: pack.conn.baudrate,
          bytesize: pack.conn.bytesize,
          parity: pack.conn.parity,
          stopbits: pack.conn.stopbits,
          host: pack.conn.host,
          tcpPort: pack.conn.tcpPort,
          slave: pack.conn.slave,
          sim: pack.conn.sim,
          label: connLabel(pack.conn),
        },
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

  if (action === 'write') {
    const fn = Number(args.function)
    const values = Array.isArray(args.values)
      ? args.values
      : (args.value !== undefined ? [args.value] : undefined)
    const cid = typeof args.connectionId === 'string' ? args.connectionId : (typeof args.connId === 'string' ? args.connId : undefined)
    const did = typeof args.deviceId === 'string' ? args.deviceId : undefined
    const ran = await modbusWrite(home, room.cwd, {
      source: origin.source,
      sessionId: origin.sessionId,
      connectionId: cid,
      connId: cid,
      deviceId: did,
      function: fn,
      address: args.address,
      values,
      pointId: typeof args.pointId === 'string' ? args.pointId : undefined,
    }, { signal })
    return { action, ...ran }
  }

  if (action === 'manual') {
    const text = typeof args.text === 'string' ? args.text.trim() : ''
    if (!text) return { ok: false, action, error: 'text 必填：描述需要用户完成的现场操作' }
    const ran = createManualRequest(home, room.cwd, {
      text,
      sessionId: origin.sessionId,
      source: origin.source,
    })
    if (!ran.ok) return { ok: false, action, error: ran.error }
    return {
      ok: true,
      action,
      requestId: ran.request.id,
      note: '已创建人工操作请求，等待用户在界面上完成；完成后会以通知回到本会话',
    }
  }

  if (action === 'connect') {
    const cid = typeof args.connectionId === 'string' ? args.connectionId : (typeof args.connId === 'string' ? args.connId : undefined)
    const did = typeof args.deviceId === 'string' ? args.deviceId : undefined
    const ran = connectOp(home, room.cwd, {
      connectionId: cid,
      connId: cid,
      deviceId: did,
      mode: args.mode,
      port: args.port,
      baudrate: args.baudrate,
      bytesize: args.bytesize,
      parity: args.parity,
      stopbits: args.stopbits,
      host: args.host,
      tcpPort: args.tcpPort,
      slave: args.slave,
      sim: args.sim,
    })
    return { action, ...ran }
  }

  if (action === 'points') {
    const cid = typeof args.connectionId === 'string' ? args.connectionId : (typeof args.connId === 'string' ? args.connId : undefined)
    const did = typeof args.deviceId === 'string' ? args.deviceId : undefined
    const ran = pointsOp(home, room.cwd, {
      op: args.op,
      point: args.point,
      points: args.points,
      id: args.id,
      ids: args.ids,
      connectionId: cid,
      connId: cid,
      deviceId: did,
    })
    return { action, ...ran }
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

  const table = args.pointId == null && args.address == null && args.function == null
  const cid = typeof args.connectionId === 'string' ? args.connectionId : (typeof args.connId === 'string' ? args.connId : undefined)
  const did = typeof args.deviceId === 'string' ? args.deviceId : undefined
  const ran = await modbusRead(home, room.cwd, {
    source: origin.source,
    sessionId: origin.sessionId,
    connectionId: cid,
    connId: cid,
    deviceId: did,
    all: table,
    pointId: args.pointId,
    function: args.function,
    address: args.address,
    count: args.count,
  }, { signal })
  return { action, ...ran }
}

export function visionBenchTool(home) {
  return {
    name: 'vision_bench',
    description:
      'Vision 台架快速接口。查询或操作当前会话工作区的调试/上位机现场。'
      + 'status：已选工程、Target、多连接（connections/devices/points+activeConnectionId/activeDeviceId, points 含 connectionId/deviceId, pollingByConnection/framesByConnection 全量）与任务时间线；'
      + 'ls：列出工作区内目录与 .uvprojx；'
      + 'select：选定工程（path 必填）；'
      + 'build：按已选或参数中的工程编译（同一类型同时只能有一个任务）；'
      + 'map：当前 Target 的组、源文件、包含路径、宏和函数名；truncated 为真时结果不完整，按组或文件再查；'
      + 'read：不传 address/function 则按点表整段读；传入则单次读；支持 connectionId/connId+deviceId 定向（pointId 校验按 connectionId+deviceId+area+address）；'
      + 'write：写线圈或保持寄存器（function 只能 1 或 3，address 必填且为原始地址 0–65535，不是 30001/40001 这类人类记法；values 数组长度 1 走单点写 FC05/06，大于 1 走批量写 FC15/16），写入后自动回读并报告一致性，支持 connectionId/connId+deviceId 定向，endpoint 指纹按连接；'
      + 'Agent 发起的 write 需要用户在界面上批准：返回 needsConfirm 时告知用户去上位机页的确认卡操作，批准或拒绝后结果会以通知回到本会话；'
      + 'connect：配置串口/TCP 连接（mode rtu|tcp、port、baudrate、bytesize 7|8、parity N|E|O、stopbits 1|2、host、tcpPort、slave），支持 connectionId/connId 定向到指定连接；'
      + 'points：配置点位表——op=list 列出全部点位与当前值，op=add/update 配合 point 或 points 数组增改（每点字段 name/function/address/scale/offset/unit/alarmMin/alarmMax，function 为 01/02/03/04，支持 connectionId/connId+deviceId 定向），op=remove 配合 ids 删除，op=clear 清空。'
      + '配置工作流：先 status 看现状 → connect 设连接 → points 建点位表 → read 验证。支持多连接，connectionId 与 connId 为别名。'
      + 'manual：请求用户完成现场人工操作（上电、接线、按复位等），text 必填，完成后会以通知回到本会话。'
      + '不要猜测工程路径或点表，一切以工具返回为准。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: ['status', 'ls', 'select', 'build', 'read', 'write', 'map', 'manual', 'connect', 'points'],
          description: 'status | ls | select | build | read | write | map | manual | connect | points',
        },
        path: { type: 'string', description: 'ls 的目录或 select/build/map 的工程绝对路径' },
        target: { type: 'string', description: 'Keil Target' },
        artifact: { type: 'string', enum: ['hex', 'bin', 'axf', 'elf'] },
        mode: { type: 'string', enum: ['rtu', 'tcp'] },
        port: { type: 'string' },
        host: { type: 'string' },
        slave: { type: 'number' },
        connectionId: { type: 'string', description: '多连接的目标连接 id，与 connId 互为别名；缺省用当前激活连接' },
        connId: { type: 'string', description: 'connectionId 的别名' },
        deviceId: { type: 'string', description: '多连接的目标设备 id，缺省用当前激活设备；points/read/write/connect 均支持' },
        pointId: { type: 'string', description: 'read 的点位 id，校验按 connectionId+deviceId+area+address' },
        function: { type: 'number', description: 'read/write 的功能码；write 只允许 1（线圈）或 3（保持寄存器）' },
        address: { type: 'number' },
        count: { type: 'number' },
        values: {
          type: 'array',
          items: { type: 'number' },
          description: 'write 的写入值数组；线圈 0/1，寄存器 0–65535',
        },
        baudrate: { type: 'number', description: 'connect 的波特率' },
        bytesize: { type: 'number', enum: [7, 8], description: 'connect 的数据位' },
        parity: { type: 'string', enum: ['N', 'E', 'O'], description: 'connect 的校验位' },
        stopbits: { type: 'number', enum: [1, 2], description: 'connect 的停止位' },
        sim: { type: 'boolean', description: 'connect 的仿真开关（不触真机）' },
        op: { type: 'string', enum: ['list', 'add', 'update', 'remove', 'clear'], description: 'points 的操作' },
        point: {
          type: 'object',
          description: 'points 单个点位：{name, function(1-4), address, scale, offset, unit, alarmMin, alarmMax, connectionId/connId, deviceId}，未指定时按 connectionId/deviceId 定向到目标连接/设备',
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            function: { type: 'number', enum: [1, 2, 3, 4] },
            address: { type: 'number' },
            scale: { type: 'number' },
            offset: { type: 'number' },
            unit: { type: 'string' },
            alarmMin: { type: 'number' },
            alarmMax: { type: 'number' },
            connectionId: { type: 'string' },
            connId: { type: 'string' },
            deviceId: { type: 'string' },
            area: { type: 'string', enum: ['coil', 'discreteInput', 'holdingRegister', 'inputRegister'] },
          },
        },
        points: {
          type: 'array',
          description: 'points 批量点位数组（op=add/update 时用），元素同 point，支持 connectionId/connId+deviceId 定向',
          items: {
            type: 'object',
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              function: { type: 'number', enum: [1, 2, 3, 4] },
              address: { type: 'number' },
              scale: { type: 'number' },
              offset: { type: 'number' },
              unit: { type: 'string' },
              alarmMin: { type: 'number' },
              alarmMax: { type: 'number' },
              connectionId: { type: 'string' },
              connId: { type: 'string' },
              deviceId: { type: 'string' },
              area: { type: 'string', enum: ['coil', 'discreteInput', 'holdingRegister', 'inputRegister'] },
            },
          },
        },
        id: { type: 'string', description: 'points remove 的单个点位 id（配合 connectionId/connId+deviceId 可定向）' },
        ids: { type: 'array', items: { type: 'string' }, description: 'points remove 的点位 id 数组（配合 connectionId/connId+deviceId 可定向）' },
        text: { type: 'string', description: 'manual 的请求内容：需要用户完成的现场操作描述' },
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
