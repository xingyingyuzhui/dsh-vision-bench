import { finalizeAgentCommandResult } from './src/application/commands/lossless-json.mjs'
import { dispatchVisionCommand } from './src/infrastructure/host/vision-host-client.mjs'

export const ACTIONS = new Set([
  'status',
  'ls',
  'select',
  'build',
  'read',
  'write',
  'map',
  'manual',
  'connect',
  'points',
  'frames',
  'focus',
  'trend',
  'visualization',
  'alarm',
  'evidence',
  'configureConnection',
  'openConnection',
  'closeConnection',
  'system.ping',
])

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

/** In-process helper used by tests; Agent execute() sets requireHost. */
export async function runVisionBench(home, args, cwd, originInput, opts) {
  const origin = originFrom(originInput)
  return finalizeAgentCommandResult(
    await dispatchVisionCommand({
      home,
      cwd,
      action: args && args.action,
      payload: args || {},
      source: origin.source,
      sessionId: origin.sessionId,
      signal: opts && opts.signal,
      commandId: opts && opts.commandId,
      expectedConfigVersion: args && (args.expectedConfigVersion ?? args.configVersion),
      requireHost: opts && opts.requireHost === true,
    }),
    origin.source,
  )
}

export function visionBenchTool(home) {
  return {
    name: 'vision_bench',
    description:
      'Vision 调试与上位机快速接口。查询或操作当前会话工作区的调试/上位机现场。' +
      'status：已选工程、Target、多连接与任务时间线；' +
      'ls/select/build/map：工程与编译；' +
      'read/write：读点与受控写点（Agent 写点需界面批准）；' +
      'connect：仅打开或断开已保存连接（close=true 断开）。修改端点用 configureConnection，打开用 openConnection；' +
      'points：op=list|add|update|remove|clear。一次调用可以批量：op=add 用 points[{name,function,address,connectionId,deviceId,...}] 数组一次写入多个点；op=update 同样用 points[]；op=remove 用 ids[] 或 pointId。不要逐个 add。address 是协议地址（保持寄存器 0 = 40001），不要填 40001。clear 必须带 connectionId+deviceId。' +
      'visualization：op=list|get|add|update|remove|layout，直接修改组件。layout 必须携带 expectedConfigVersion 与 items[{id,x,y,w,h}]；CONFIG_DRIFT 后重新 list/get 再提交。当前 Session 可视化页面会实时同步布局。proposeAdd/proposeUpdate/proposeRemove 已移除（OP_REMOVED）。' +
      '所有配置修改必须携带最近一次 status/list/get 返回的 configVersion。CONFIG_DRIFT 后必须重新读取配置，再基于新版本重试；不得盲目重复旧修改。适用 config、configureConnection、points add/update/remove/clear、visualization add/update/remove/layout。status、points list、visualization list/get 不要求版本。' +
      'frames/focus/trend/alarm/evidence：现场只读与定位；' +
      'manual：请求用户完成现场操作；' +
      'system.ping：无副作用探活 Host（不读写串口、不启动采集）。' +
      '配置修改立即生效并记入操作记录；向真实设备写值、烧录、复位仍需用户批准。',
    parameters: {
      type: 'object',
      additionalProperties: false,
      required: ['action'],
      properties: {
        action: {
          type: 'string',
          enum: [...ACTIONS],
          description: [...ACTIONS].join(' | '),
        },
        path: { type: 'string', description: 'ls 的目录或 select/build/map 的工程绝对路径' },
        keilTarget: { type: 'string', description: 'Keil Target（build/map 也接受 target 字符串）' },
        artifact: { type: 'string', enum: ['hex', 'bin', 'axf', 'elf'] },
        mode: { type: 'string', enum: ['rtu', 'tcp'] },
        port: { type: 'string' },
        host: { type: 'string' },
        slave: { type: 'number' },
        unitId: { type: 'number' },
        connectionId: { type: 'string' },
        connId: { type: 'string' },
        deviceId: { type: 'string' },
        pointId: { type: 'string' },
        function: { type: 'number' },
        address: { type: 'number' },
        count: { type: 'number' },
        values: { type: 'array', items: { type: 'number' } },
        baudrate: { type: 'number' },
        bytesize: { type: 'number', enum: [7, 8] },
        parity: { type: 'string', enum: ['N', 'E', 'O'] },
        stopbits: { type: 'number', enum: [1, 2] },
        sim: { type: 'boolean' },
        op: { type: 'string', enum: ['list', 'get', 'add', 'update', 'remove', 'clear', 'layout'] },
        items: {
          type: 'array',
          description: 'visualization op=layout 的目标矩形列表',
          items: {
            type: 'object',
            additionalProperties: false,
            required: ['id', 'x', 'y', 'w', 'h'],
            properties: {
              id: { type: 'string' },
              x: { type: 'number' },
              y: { type: 'number' },
              w: { type: 'number' },
              h: { type: 'number' },
            },
          },
        },
        point: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            function: { type: 'number' },
            address: { type: 'number' },
            monitorEnabled: { type: 'boolean' },
            alarmEnabled: { type: 'boolean' },
            trendEnabled: { type: 'boolean' },
            connectionId: { type: 'string' },
            deviceId: { type: 'string' },
          },
        },
        points: {
          type: 'array',
          description: 'op=add/update 一次提交多个点位。优先用这个数组，不要循环单点 add。',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              id: { type: 'string' },
              name: { type: 'string' },
              function: { type: 'number' },
              address: { type: 'number', description: '协议地址，保持寄存器 0 = 40001' },
              scale: { type: 'number' },
              offset: { type: 'number' },
              unit: { type: 'string' },
              alarmMin: { type: 'number' },
              alarmMax: { type: 'number' },
              monitorEnabled: { type: 'boolean' },
              alarmEnabled: { type: 'boolean' },
              trendEnabled: { type: 'boolean' },
              connectionId: { type: 'string' },
              deviceId: { type: 'string' },
            },
          },
        },
        id: { type: 'string' },
        ids: { type: 'array', items: { type: 'string' }, description: 'op=remove 一次删除多个点位' },
        text: { type: 'string' },
        frameId: { type: 'string' },
        trendKey: { type: 'string' },
        alarmId: { type: 'string' },
        kind: { type: 'string' },
        limit: { type: 'number' },
        offset: { type: 'number' },
        start: { type: 'number' },
        end: { type: 'number' },
        pointIds: { type: 'array', items: { type: 'string' } },
        visualizationId: { type: 'string' },
        component: {
          type: 'object',
          additionalProperties: true,
          properties: {
            id: { type: 'string' },
            name: { type: 'string' },
            type: { type: 'string', enum: ['line', 'bar', 'value', 'switch'] },
            pointIds: { type: 'array', items: { type: 'string' } },
            order: { type: 'number' },
            settings: {
              type: 'object',
              additionalProperties: true,
              properties: {
                windowMs: { type: 'number' },
                confirmWrite: { type: 'boolean' },
              },
            },
            layout: {
              type: 'object',
              additionalProperties: false,
              properties: {
                x: { type: 'number' },
                y: { type: 'number' },
                w: { type: 'number' },
                h: { type: 'number' },
              },
            },
          },
        },
        tempWatchIds: { type: 'array', items: { type: 'string' } },
        tempWatch: { type: 'array', items: { type: 'string' } },
        evidence: {
          type: 'array',
          items: {
            type: 'object',
            additionalProperties: true,
            properties: {
              kind: { type: 'string' },
              visualizationId: { type: 'string' },
              componentType: { type: 'string' },
              pointIds: { type: 'array', items: { type: 'string' } },
            },
          },
        },
        focus: { type: 'object', additionalProperties: true },
        target: {
          type: 'object',
          additionalProperties: true,
          properties: {
            connectionId: { type: 'string' },
            deviceId: { type: 'string' },
            pointId: { type: 'string' },
            visualizationId: { type: 'string' },
            kind: { type: 'string' },
          },
        },
        badgeOnly: { type: 'boolean' },
        foreground: { type: 'boolean' },
        expectedConfigVersion: {
          type: 'number',
          description:
            '配置修改必须携带最近一次 status/list/get 返回的 configVersion；不一致时返回 CONFIG_DRIFT，缺失时返回 CONFIG_VERSION_REQUIRED',
        },
        configVersion: { type: 'number', description: 'expectedConfigVersion 别名' },
        commandId: { type: 'string', description: '幂等键' },
        name: { type: 'string' },
        close: { type: 'boolean' },
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
      if (signal && signal.aborted)
        return finalizeAgentCommandResult({ ok: false, cancelled: true, error: '已取消' }, 'agent')
      return finalizeAgentCommandResult(
        await dispatchVisionCommand({
          home,
          cwd: cwdOf(agent),
          action: args && args.action,
          payload: args || {},
          source: 'agent',
          sessionId: sessionIdOf(agent),
          signal,
          commandId: args && args.commandId,
          expectedConfigVersion: args && (args.expectedConfigVersion ?? args.configVersion),
          requireHost: true,
        }),
        'agent',
      )
    },
  }
}

export const _internal = { ACTIONS, originFrom }
