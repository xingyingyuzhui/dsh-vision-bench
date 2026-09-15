import assert from 'node:assert/strict'
import { readFile, writeFile } from 'node:fs/promises'
import { join } from 'node:path'
import test from 'node:test'
import { PRESET_METADATA } from '../../bench-preset.mjs'
import { loadWorkspace, saveWorkspace } from '../../bench-store.mjs'
import { runVisionBench, visionBenchTool } from '../../bench-tool.mjs'
import { apply as applyAgent } from '../../tools.js'
import { LEGACY_PERSONA_A, LEGACY_PERSONA_B } from '../helpers/preset-fixtures.mjs'
import { createBench } from '../helpers/workspace-factory.mjs'

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
