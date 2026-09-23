// @ts-check
import { finalizeAgentCommandResult } from '../../application/commands/lossless-json.mjs'
import { projectAgentResult } from '../../application/commands/agent-result-projection.mjs'
import { attachConfigDriftRefresh } from '../../application/commands/config-drift-refresh.mjs'
import { executeHostCommand } from '../../application/commands/host-command-service.mjs'
import { dispatchVisionCommand } from '../../infrastructure/host/vision-host-client.mjs'
import { loadWorkspace } from '../../infrastructure/store/workspace-store.mjs'
import { modbusForSession } from '../../application/modbus/workspace-session-view.mjs'
import { validateAgentToolArgs } from './agent-tool-preflight.mjs'

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
  'config',
  'configureConnection',
  'openConnection',
  'closeConnection',
  'system.ping',
])

/**
 * @param {any} [agent]
 * @returns {any}
 */
export const cwdOf = (agent) => {
  const session = agent && agent.session
  const header = session && session.header
  return header && header.cwd ? String(header.cwd) : ''
}

/**
 * @param {any} [agent]
 * @returns {any}
 */
export const sessionIdOf = (agent) => {
  const session = agent && agent.session
  const header = session && session.header
  if (header && header.id) return String(header.id)
  if (session && session.id) return String(session.id)
  return ''
}

/**
 * @param {any} [input]
 * @returns {any}
 */
const originFrom = (input) => ({
  source: input && input.source === 'agent' ? 'agent' : 'user',
  sessionId: input && input.sessionId ? String(input.sessionId) : '',
})

/**
 * Test / app-service helper: calls the Host application layer directly.
 * Production Agent tools must use `visionBenchTool` → `dispatchVisionCommand({ requireHost: true })`
 * so missing Host never falls back to a second local writer.
 * Keeps full Host results (no Agent projection) for business tests.
 * @param {any} [home]
 * @param {any} [args]
 * @param {any} [cwd]
 * @param {any} [originInput]
 * @param {any} [opts]
 * @returns {Promise<any>}
 */
export async function runVisionBench(home, args, cwd, originInput, opts) {
  const origin = originFrom(originInput)
  return finalizeAgentCommandResult(
    await executeHostCommand({
      home,
      cwd,
      action: args && args.action,
      payload: args || {},
      source: origin.source,
      sessionId: origin.sessionId,
      signal: opts && opts.signal,
      commandId: opts && opts.commandId,
      expectedConfigVersion: args && (args.expectedConfigVersion ?? args.configVersion),
      transport: opts && opts.transport,
    }),
    origin.source,
  )
}

/**
 * @param {any} [home]
 * @returns {any}
 */
export function visionBenchTool(home) {
  return {
    name: 'vision_bench',
    description:
      'Vision 调试与上位机快速接口。查询或操作当前会话工作区的调试/上位机现场。' +
      'status：已选工程、Target、多连接摘要与任务时间线（不含历史帧/全量值）；' +
      'ls/select/build/map：工程与编译；' +
      'read/write：读点与受控写点（必须带 connectionId+deviceId；Agent 写点需界面批准）；' +
      'connect：仅打开或断开已保存连接（close=true 断开）。修改端点用 configureConnection，打开用 openConnection；' +
      'points：op=list|add|update|remove|clear。一次调用可以批量：op=add 用 points[{name,function,address,connectionId,deviceId,...}] 数组一次写入多个点；op=update 同样用 points[]；op=remove 用 ids[] 或 pointId。不要逐个 add。address 是协议地址（保持寄存器 0 = 40001），不要填 40001。clear 必须带 connectionId+deviceId。监视开关用 monitorEnabled；trendEnabled 只是旧别名，同请求传相反值会 FIELD_CONFLICT。' +
      'visualization：op=list|get|add|update|remove|layout。get 必须带 visualizationId（缺 ID 不会默认取第一个组件）。layout 必须携带 expectedConfigVersion 与 items[{id,x,y,w,h}]；CONFIG_DRIFT 后按 refresh 提示重新 list/get 再提交。' +
      '所有配置修改必须携带最近一次 status/list/get 返回的 configVersion（字段名 expectedConfigVersion；configVersion 为别名）。CONFIG_DRIFT 后必须重新读取配置，再基于新版本重试；不得把 actualVersion 当重试凭证。适用 config、configureConnection、points add/update/remove/clear、visualization add/update/remove/layout。status、points list、visualization list/get 不要求版本。' +
      'frames/trend/alarm：需要 connectionId（alarm 仅有 alarmId、trend 仅有 trendKey 时可例外）；trend 的 limit 是每条序列的样本数；trend 分页用每条 series 的 hasMore/oldestReturnedAt（再查 pointIds:[id], end:oldestReturnedAt-1，沿用原 start；多序列分别翻页，不要用一条序列的边界过滤全部序列），不是 nextCursor。hasMore:false 时无后续翻页。' +
      'focus 会改变 UI 焦点；evidence[] 会追加日志——二者不是纯只读。' +
      'alarm 带 watch/followup=true 才订阅过程量告警跟进；watch/followup=false 取消本会话订阅（不需要 connectionId/alarmId）；二者同义，同时传且布尔值不同会 FIELD_CONFLICT。默认过程告警只记事件不唤醒 Agent。' +
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
        connectionId: {
          type: 'string',
          description: '规范字段。frames/trend/alarm 必填；read/write 与 deviceId 一起必填',
        },
        connId: {
          type: 'string',
          description: 'connectionId 的兼容别名；优先使用 connectionId',
        },
        deviceId: {
          type: 'string',
          description: '规范字段。read/write 与 connectionId 一起必填',
        },
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
        operation: {
          type: 'string',
          description:
            'action=config 的配置操作，如 connection.create / connection.update / connection.remove / points.* / visualization.*',
        },
        value: {
          type: 'object',
          description:
            'action=config 的配置值（配合 operation/target）。configureConnection 与 points 不用这个字段，直接平铺参数。',
          additionalProperties: true,
        },
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
            monitorEnabled: {
              type: 'boolean',
              description: '规范监视开关（可视化数据源）',
            },
            alarmEnabled: { type: 'boolean' },
            trendEnabled: {
              type: 'boolean',
              description: 'monitorEnabled 的旧别名；同请求传相反值返回 FIELD_CONFLICT',
            },
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
            alarmDeadband: {
              type: 'number',
              description: '告警回差（工程单位，≥0）。缺省为 |阈值|×1%；显式 0 表示无回差',
            },
              monitorEnabled: {
                type: 'boolean',
                description: '规范监视开关',
              },
              alarmEnabled: { type: 'boolean' },
              trendEnabled: {
                type: 'boolean',
                description: 'monitorEnabled 的旧别名；冲突时 FIELD_CONFLICT，批量原子失败',
              },
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
        limit: {
          type: 'number',
          description: 'frames 条数，或 trend 每条序列的样本数（不是跨序列总数）',
        },
        offset: { type: 'number' },
        start: { type: 'number' },
        end: { type: 'number' },
        pointIds: { type: 'array', items: { type: 'string' } },
        visualizationId: {
          type: 'string',
          description: 'visualization get/update/remove 的组件 ID；get 缺省不会默认首个组件',
        },
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
          description: '追加证据日志（有副作用，非纯只读）',
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
        focus: {
          type: 'object',
          description: '改变 UI 焦点（有副作用，非纯只读）',
          additionalProperties: true,
        },
        target: {
          type: 'object',
          description: 'action=config 的操作目标，如 { connectionId, deviceId, pointId, visualizationId }',
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
            '规范字段。配置修改必须携带最近一次 status/list/get 返回的 configVersion；不一致时返回 CONFIG_DRIFT（含 refresh 提示），缺失时返回 CONFIG_VERSION_REQUIRED',
        },
        configVersion: {
          type: 'number',
          description: 'expectedConfigVersion 的兼容别名；优先使用 expectedConfigVersion',
        },
        commandId: { type: 'string', description: '幂等键' },
        name: { type: 'string' },
        close: { type: 'boolean' },
        watch: {
          type: 'boolean',
          description: 'action=alarm 时：true 订阅过程量告警 Agent 跟进；false 取消本会话订阅（不需要目标 ID）。与 followup 同义，同时传相反值返回 FIELD_CONFLICT',
        },
        followup: {
          type: 'boolean',
          description: 'action=alarm 时与 watch 同义：true 订阅，false 取消本会话订阅；同时传相反值返回 FIELD_CONFLICT',
        },
        monitorEnabled: {
          type: 'boolean',
          description: '规范监视开关（也可写在 point/points 内）',
        },
        trendEnabled: {
          type: 'boolean',
          description: 'monitorEnabled 旧别名（也可写在 point/points 内）',
        },
      },
    },
    output: {
      schema: { type: 'object', additionalProperties: true },
      render(/** @type {any} */ _args, /** @type {any} */ value) {
        return [{ type: 'text', text: JSON.stringify(value, null, 2) }]
      },
    },
    timeoutMs: 620000,
    async execute(/** @type {any} */ args, /** @type {any} */ exec) {
      const agent = exec && exec.agent
      const signal = exec && exec.signal
      if (signal && signal.aborted)
        return finalizeAgentCommandResult({ ok: false, cancelled: true, error: '已取消' }, 'agent')
      const cwd = cwdOf(agent)
      const sessionId = sessionIdOf(agent)
      /** @type {any} */
      let pack = null
      const action = args && args.action
      if ((action === 'alarm' || action === 'trend') && cwd) {
        try {
          const ws = loadWorkspace(home, cwd)
          pack = modbusForSession(ws, sessionId)
        } catch {
          pack = null
        }
      }
      const preflight = validateAgentToolArgs(args, { pack })
      if (preflight) return finalizeAgentCommandResult(preflight, 'agent')
      const dispatched = await dispatchVisionCommand({
        home,
        cwd,
        action: args && args.action,
        payload: args || {},
        source: 'agent',
        sessionId,
        signal,
        commandId: args && args.commandId,
        expectedConfigVersion: args && (args.expectedConfigVersion ?? args.configVersion),
        requireHost: true,
      })
      const withRefresh = attachConfigDriftRefresh(dispatched, {
        action: args && args.action,
        op: args && args.op,
        operation: args && args.operation,
        target: {
          visualizationId: args && (args.visualizationId || args.id),
          connectionId: args && (args.connectionId || args.connId),
          deviceId: args && args.deviceId,
          pointId: args && (args.pointId || args.id),
        },
      })
      const projected = projectAgentResult(args || {}, withRefresh)
      return finalizeAgentCommandResult(projected, 'agent')
    },
  }
}

export const _internal = { ACTIONS, originFrom }
