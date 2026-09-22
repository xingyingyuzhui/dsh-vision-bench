import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { PRESET_METADATA } from '../../bench-preset.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench, visionBenchTool } from '../../bench-tool.mjs'
import { apply as applyAgent } from '../../tools.js'
import { LEGACY_PERSONA_A, LEGACY_PERSONA_B } from '../helpers/preset-fixtures.mjs'
import { ERROR_CODES } from '../../src/domain/modbus/errors.mjs'
import { connection, createBench, pointSeries } from '../helpers/workspace-factory.mjs'
import {
  registerVisionHost,
  unregisterVisionHost,
} from '../../src/infrastructure/host/vision-host-client.mjs'
import { createVisionCommandDispatcher } from '../../src/interfaces/http/vision-command-routes.mjs'
import { validateAgentToolArgs } from '../../src/interfaces/agent/agent-tool-preflight.mjs'

test('agent role registers vision_bench and skips HTTP routes', async () => {
  const tools = []
  const sections = []
  applyAgent({
    tools: {
      register(def) {
        tools.push(def)
        return () => {}
      },
    },
    systemPrompt: {
      section(def) {
        sections.push(def)
        return () => {}
      },
    },
    agentPresets: {},
    webServer: {
      register() {
        throw new Error('host routes must not mount on agent plane')
      },
    },
    effect(factory) {
      factory()
    },
  })
  assert.equal(tools.length, 2)
  assert.equal(sections.length, 1)
  assert.equal(sections[0].name, 'vision-bench:guidance')
  const benchTool = tools.find((t) => t.name === 'vision_bench')
  const debugTool = tools.find((t) => t.name === 'vision_debug')
  assert.ok(benchTool)
  assert.ok(debugTool)
  assert.equal(benchTool.parameters.type, 'object')
  assert.ok(benchTool.parameters.properties.action.enum.includes('map'))
  assert.ok(benchTool.parameters.required.includes('action'))
  assert.equal(debugTool.parameters.type, 'object')
  assert.ok(debugTool.parameters.properties.action.enum.includes('breakpoint'))
})
test('agent loader uses a distinct name and injects tools plus systemPrompt', async () => {
  const { name, inject } = await import('../../tools.js')
  assert.equal(name, 'dsh-vision-bench-tools')
  assert.deepEqual(inject, ['tools', 'systemPrompt'])
  const src = await readFile(new URL('../../tools.js', import.meta.url), 'utf8')
  assert.doesNotMatch(src, /bench-preset\.mjs/)
  assert.match(src, /bench-guidance\.mjs/)
  assert.match(src, /dsh-home\.mjs/)
})
test('new Vision copy does not show 台架; legacy personas still contain 台架 for migration', () => {
  assert.match(PRESET_METADATA, /^name: Vision模式$/m)
  assert.match(PRESET_METADATA, /Vision 调试与上位机接口/)
  assert.equal(PRESET_METADATA.includes('Vision 台架'), false)
  const tool = visionBenchTool('/tmp')
  assert.match(tool.description, /Vision 调试与上位机快速接口/)
  assert.match(tool.description, /所有配置修改必须携带最近一次 status\/list\/get 返回的 configVersion/)
  assert.equal(tool.description.includes('Vision 台架'), false)
  assert.equal(LEGACY_PERSONA_A.includes('Vision 台架'), true)
  assert.equal(LEGACY_PERSONA_B.includes('Vision 台架'), true)
})
test('runVisionBench status and select stay inside the workspace', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-tool-' })
  const { home, cwd } = bench
  const miss = await runVisionBench(home, { action: 'status' }, '')
  assert.equal(miss.ok, false)
  const project = join(cwd, 'app.uvprojx')
  await writeFile(project, '<Project/>')
  const selected = await runVisionBench(home, { action: 'select', path: project }, cwd)
  assert.equal(selected.ok, true)
  assert.equal(selected.keil.project, project)
  const status = await runVisionBench(home, { action: 'status' }, cwd)
  assert.equal(status.ok, true)
  assert.equal(status.keil.project, project)
  assert.ok(status.log.some((item) => item.action === 'select-project'))
  assert.ok(Array.isArray(status.tasks))
  assert.ok(Array.isArray(status.running))
  assert.ok(Array.isArray(status.modbus.points))
  assert.ok(status.modbus.conn && typeof status.modbus.conn === 'object')
  assert.ok(status.timeline.some((item) => item.kind === 'select-project'))
  const escaped = await runVisionBench(home, { action: 'select', path: join(home, 'other.uvprojx') }, cwd)
  assert.equal(escaped.ok, false)
})
test('agent single-point read patches the active device address', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-read-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      conn: { sim: true },
      points: [{ name: 'p', function: 3, address: 0 }],
    },
  })
  const ran = await runVisionBench(home, { action: 'read', function: 3, address: 10, count: 1 }, cwd, {
    source: 'agent',
  })
  assert.equal(ran.ok, true)
  assert.match(ran.summary || ran.result?.summary || ran.summary || '', /读取成功/)
  const ws = loadWorkspace(home, cwd)
  // point model keeps the read as a transient operation; points table unchanged
  assert.ok(Array.isArray(ws.modbus.points))
  assert.equal(ws.modbus.points.length, 1)
})
test('Task3/0.20.1: 工具 Schema 完整开放 visualization / component / op 全合法值 / 点位字段', async () => {
  const tool = visionBenchTool('/tmp')
  const props = tool.parameters.properties
  assert.ok(props.action.enum.includes('visualization'), 'action.enum 含 visualization')
  assert.ok(props.visualizationId, 'visualizationId 顶层参数')
  const comp = props.component
  assert.ok(comp, 'component 参数')
  for (const k of ['id', 'name', 'type', 'pointIds', 'order', 'settings'])
    assert.ok(k in comp.properties, 'component.' + k)
  assert.deepEqual(comp.properties.type.enum, ['line', 'bar', 'value', 'switch'])
  for (const k of ['windowMs', 'confirmWrite']) assert.ok(k in comp.properties.settings.properties, 'settings.' + k)
  for (const op of ['proposeAdd', 'proposeUpdate', 'proposeRemove', 'discard']) {
    assert.equal(props.op.enum.includes(op), false, 'op.enum 不含已移除 ' + op)
  }
  for (const op of ['list', 'get', 'add', 'update', 'remove', 'clear', 'layout'])
    assert.ok(props.op.enum.includes(op), 'op.enum 含 ' + op)
  assert.ok(props.items, 'layout items 参数')
  assert.deepEqual(props.items.items.required, ['id', 'x', 'y', 'w', 'h'])
  assert.ok(comp.properties.layout, 'component.layout')
  assert.deepEqual(Object.keys(comp.properties.layout.properties).sort(), ['h', 'w', 'x', 'y'])
  const pointProps = props.point.properties
  for (const k of ['monitorEnabled', 'alarmEnabled', 'trendEnabled']) assert.ok(k in pointProps, 'point.' + k)
  const itemsProps = props.points.items.properties
  for (const k of ['monitorEnabled', 'alarmEnabled', 'trendEnabled']) assert.ok(k in itemsProps, 'points.items.' + k)
})
test('Task3/0.20.1: status 点位含 runtimeStatus（复用 pointRuntimeStatus）', async (t) => {
  const bench = await createBench(t, { prefix: 'st-st-' })
  const { home, cwd } = bench
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', slave: 1, sim: true } }],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points: [
        {
          id: 'p1',
          connectionId: 'c1',
          deviceId: 'd1',
          name: '温度',
          function: 3,
          address: 0,
          monitorEnabled: true,
          alarmEnabled: false,
          alarmMin: null,
          alarmMax: 100,
        },
      ],
      values: [{ key: 'p1', pointId: 'p1', raw: 20, value: 20, ok: true, at: Date.now() }],
      alarmState: {},
    },
  })
  const res = await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent', sessionId: 's1' })
  const pt = res.modbus.points.find((x) => x.id === 'p1')
  assert.equal(pt.monitorEnabled, true)
  assert.equal(pt.alarmEnabled, false)
  assert.equal(pt.trendEnabled, true)
  assert.ok(pt.runtimeStatus, 'runtimeStatus 存在')
  assert.ok(
    ['正常', '未读取', '告警', '通信异常', '已断开', '连接异常'].includes(pt.runtimeStatus),
    '状态值合法: ' + pt.runtimeStatus,
  )
})

test('status and points list agree after claim; other session stays isolated', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-status-scope-' })
  const { home, cwd } = bench
  const conn = connection('real-c1', 'tcp', '', { sim: true })
  const points = pointSeries('hr', 16, { connectionId: 'real-c1', deviceId: 'real-d1' }).map((p, i) => ({
    ...p,
    id: `p${i}`,
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 7,
      connections: [conn],
      devices: [{ id: 'real-d1', connectionId: 'real-c1', name: 'D1', unitId: 1 }],
      points,
    },
  })

  const originA = { source: 'agent', sessionId: 'session-a' }
  const statusA = await runVisionBench(home, { action: 'status' }, cwd, originA)
  assert.equal(statusA.ok, true, statusA.error)
  assert.equal(statusA.configVersion, 7)
  assert.equal(statusA.modbus.configVersion, 7)
  assert.equal(statusA.modbus.points.length, 16)

  const listA = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, originA)
  assert.equal(listA.ok, true, listA.error)
  assert.equal(listA.configVersion, statusA.configVersion)
  assert.deepEqual(
    listA.points.map((/** @type {any} */ p) => p.id).sort(),
    statusA.modbus.points.map((/** @type {any} */ p) => p.id).sort(),
  )
  assert.deepEqual(
    statusA.modbus.connections.map((/** @type {any} */ c) => c.id).sort(),
    ['real-c1'],
  )
  assert.deepEqual(
    statusA.modbus.devices.map((/** @type {any} */ d) => d.id).sort(),
    ['real-d1'],
  )
  assert.equal(loadWorkspace(home, cwd).modbus.points?.length || 0, 0, 'claimed topology leaves flat layer empty')

  const statusB = await runVisionBench(home, { action: 'status' }, cwd, {
    source: 'agent',
    sessionId: 'session-b',
  })
  assert.equal(statusB.ok, true, statusB.error)
  assert.deepEqual(statusB.modbus.points, [])
  assert.ok(
    !statusB.modbus.connections.some((/** @type {any} */ c) => c.id === 'real-c1'),
    'other session must not see claimed private connection',
  )
  assert.ok(!statusB.modbus.devices.some((/** @type {any} */ d) => d.id === 'real-d1'))

  const listB = await runVisionBench(home, { action: 'points', op: 'list' }, cwd, {
    source: 'agent',
    sessionId: 'session-b',
  })
  assert.equal(listB.ok, true, listB.error)
  assert.deepEqual(listB.points, [])

  const anon = await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent' })
  assert.equal(anon.ok, false)
  assert.equal(anon.errorCode, ERROR_CODES.SESSION_REQUIRED)
})

test('Agent tool schema marks preferred fields and aliases; focus/evidence are not read-only', () => {
  const tool = visionBenchTool('/tmp')
  const props = tool.parameters.properties
  assert.match(props.connectionId.description, /规范/)
  assert.match(props.connId.description, /别名/)
  assert.match(props.expectedConfigVersion.description, /规范/)
  assert.match(props.configVersion.description, /别名/)
  assert.match(props.point.properties.monitorEnabled.description, /规范/)
  assert.match(props.point.properties.trendEnabled.description, /别名/)
  assert.match(tool.description, /focus 会改变 UI/)
  assert.match(tool.description, /evidence\[\] 会追加日志/)
  assert.match(tool.description, /get 必须带 visualizationId/)
  assert.match(props.limit.description, /每条序列的样本数/)
})

test('Agent execute preflight returns missingFields once for read/frames', async () => {
  unregisterVisionHost()
  const stop = registerVisionHost({
    dispatch() {
      throw new Error('host must not run when preflight fails')
    },
  })
  try {
    const tool = visionBenchTool('/tmp')
    const read = await tool.execute(
      { action: 'read', pointId: 'p1' },
      { agent: { session: { header: { cwd: '/tmp', id: 's1' } } } },
    )
    assert.equal(read.ok, false)
    assert.equal(read.errorCode, 'TARGET_REQUIRED')
    assert.deepEqual(read.missingFields, ['connectionId', 'deviceId'])
    assert.match(String(read.hint || ''), /connectionId/)

    const frames = await tool.execute(
      { action: 'frames' },
      { agent: { session: { header: { cwd: '/tmp', id: 's1' } } } },
    )
    assert.equal(frames.ok, false)
    assert.deepEqual(frames.missingFields, ['connectionId'])
  } finally {
    stop()
    unregisterVisionHost()
  }
})

test('alarm watch:false unsubscribe needs no connectionId; FIELD_CONFLICT on opposite flags', () => {
  const miss = validateAgentToolArgs({ action: 'alarm', watch: false }, {})
  assert.equal(miss, null, 'unsubscribe must not require connectionId')

  const conflict = validateAgentToolArgs({ action: 'alarm', watch: true, followup: false }, {})
  assert.equal(conflict?.errorCode, 'FIELD_CONFLICT')

  const conflict2 = validateAgentToolArgs({ action: 'alarm', watch: false, followup: true }, {})
  assert.equal(conflict2?.errorCode, 'FIELD_CONFLICT')

  const bothFalse = validateAgentToolArgs({ action: 'alarm', watch: false, followup: false }, {})
  assert.equal(bothFalse, null)

  const subscribeStillNeedsTarget = validateAgentToolArgs({ action: 'alarm', watch: true }, {})
  assert.equal(subscribeStillNeedsTarget?.errorCode, 'TARGET_REQUIRED')
})

test('production visionBenchTool alarm watch:false clears only this session without connectionId', async (t) => {
  const { createBench } = await import('../helpers/workspace-factory.mjs')
  const { setAgentAlarmWatch, getAgentAlarmWatch, disposeAlarmNotifyRuntime } = await import(
    '../../src/application/modbus/poll-alarm-notify.mjs'
  )
  const bench = await createBench(t, { prefix: 'dvb-unsub-' })
  const { home, cwd } = bench
  disposeAlarmNotifyRuntime()
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  try {
    setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-a', pointIds: [] })
    setAgentAlarmWatch(cwd, { followup: true, sessionId: 'sess-b', pointIds: [] })
    const tool = visionBenchTool(home)
    const exec = {
      agent: { session: { header: { cwd, id: 'sess-a' } } },
    }
    const off = await tool.execute({ action: 'alarm', watch: false }, exec)
    assert.equal(off.ok, true, JSON.stringify(off))
    assert.equal(off.subscription?.cleared, true)
    assert.equal(off.subscription?.sessionId, 'sess-a')
    assert.equal(getAgentAlarmWatch(cwd, 'sess-a'), null)
    assert.ok(getAgentAlarmWatch(cwd, 'sess-b'), 'other session watch must survive')

    const again = await tool.execute({ action: 'alarm', watch: false }, exec)
    assert.equal(again.ok, true, 'unsubscribe is idempotent')

    const bad = await tool.execute({ action: 'alarm', watch: true, followup: false }, exec)
    assert.equal(bad.ok, false)
    assert.equal(bad.errorCode, 'FIELD_CONFLICT')
  } finally {
    stop()
    unregisterVisionHost()
    disposeAlarmNotifyRuntime()
  }
})

test('Agent preflight alarmId without unique connection matches Host TARGET_REQUIRED', () => {
  const pack = {
    connections: [
      { id: 'c1', enabled: true },
      { id: 'c2', enabled: true },
    ],
    devices: [
      { id: 'd1', connectionId: 'c1' },
      { id: 'd2', connectionId: 'c2' },
    ],
    points: [],
    alarmState: {
      // alarm without connectionId and no unique single-conn fallback
      shared: { condition: 'active', pointId: 'px' },
    },
  }
  const miss = validateAgentToolArgs({ action: 'alarm', alarmId: 'shared' }, { pack })
  assert.ok(miss)
  assert.equal(miss.errorCode, 'TARGET_REQUIRED')
  assert.ok(miss.missingFields.includes('connectionId'))

  const ok = validateAgentToolArgs(
    { action: 'alarm', alarmId: 'shared', connectionId: 'c1' },
    {
      pack: {
        ...pack,
        alarmState: { shared: { condition: 'active', pointId: 'px', connectionId: 'c1' } },
      },
    },
  )
  assert.equal(ok, null)
})

test('Agent execute projects status/read; Host runVisionBench keeps full status points', async (t) => {
  const bench = await createBench(t, { prefix: 'dvb-proj-' })
  const { home, cwd } = bench
  const conn = connection('c1', 'tcp', '', { sim: true })
  const points = pointSeries('hr', 16, { connectionId: 'c1', deviceId: 'd1' }).map((p, i) => ({
    ...p,
    id: `p${i}`,
    monitorEnabled: true,
    alarmEnabled: false,
  }))
  saveWorkspace(home, cwd, {
    modbus: {
      version: 3,
      configVersion: 3,
      connections: [conn],
      devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
      points,
      values: points.map((p) => ({ pointId: p.id, key: p.id, raw: 1, value: 1, ok: true, at: 1 })),
      framesByConnection: {
        c1: Array.from({ length: 40 }, (_, i) => ({ id: `f${i}`, frameId: `f${i}`, transactionId: `tx${i}` })),
      },
      alarmState: { p0: { condition: 'normal', pointId: 'p0' } },
    },
  })
  unregisterVisionHost()
  const stop = registerVisionHost(createVisionCommandDispatcher(home))
  try {
    const tool = visionBenchTool(home)
    const agent = { session: { header: { cwd, id: 's1' } } }
    const status = await tool.execute({ action: 'status' }, { agent })
    assert.equal(status.ok, true, status.error)
    assert.equal(status.modbus.counts.points, 16)
    assert.equal('framesByConnection' in status.modbus, false)
    assert.equal('points' in status.modbus, false)

    const full = await runVisionBench(home, { action: 'status' }, cwd, { source: 'agent', sessionId: 's1' })
    assert.equal(full.modbus.points.length, 16, 'runVisionBench keeps full Host status')

    const read = await tool.execute(
      { action: 'read', connectionId: 'c1', deviceId: 'd1', pointId: 'p0' },
      { agent },
    )
    assert.equal(read.ok, true, read.error)
    assert.equal('framesByConnection' in read, false)
    assert.ok(Array.isArray(read.values))
    assert.ok(read.values.every((/** @type {any} */ v) => v.pointId === 'p0' || v.key === 'p0'))
  } finally {
    stop()
    unregisterVisionHost()
  }
})
