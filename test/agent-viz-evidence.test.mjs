import assert from 'node:assert/strict'
import { mkdir, mkdtemp, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import test from 'node:test'
import { agentRefToText, buildAgentRef, dispatchAgentRef, evidenceFromRef } from '../bench-shared.mjs'
import { appendEvidence, loadWorkspace, saveWorkspace } from '../bench-store.mjs'
import { visionBenchTool } from '../bench-tool.mjs'

test('剪贴板回退文本是完整 JSON，含 visualizationId/pointIds', () => {
  const ref = buildAgentRef('visualization', {
    visualizationId: 'viz_1',
    type: 'line',
    pointIds: ['p1', 'p2'],
    name: '趋势',
  }, { configVersion: 7, start: 1, end: 2 })
  const text = agentRefToText(ref)
  const parsed = JSON.parse(text)
  assert.equal(parsed.kind, 'visualization')
  assert.equal(parsed.visualizationId, 'viz_1')
  assert.deepEqual(parsed.pointIds, ['p1', 'p2'])
  assert.equal(parsed.componentType, 'line')
  assert.ok(!text.startsWith('[visualization]'))
})

test('evidenceFromRef / appendEvidence 保留 visualizationId', async () => {
  const home = await mkdtemp(join(tmpdir(), 'dvb-viz-ev-'))
  const cwd = join(home, 'board')
  await mkdir(cwd)
  try {
    saveWorkspace(home, cwd, {
      modbus: {
        version: 3,
        configVersion: 3,
        connections: [{ id: 'c1', name: 'C1', conn: { mode: 'rtu', port: 'COM3', sim: true } }],
        devices: [{ id: 'd1', connectionId: 'c1', name: 'D1', unitId: 1 }],
        points: [{ id: 'p1', connectionId: 'c1', deviceId: 'd1', name: 'T', function: 3, address: 0, monitorEnabled: true }],
        visualization: { schemaVersion: 1, components: [{ id: 'viz_9', name: '卡', type: 'value', pointIds: ['p1'] }] },
      },
    })
    const ws0 = loadWorkspace(home, cwd)
    const cv = ws0.modbus.configVersion || 1
    const ref = buildAgentRef('visualization', { visualizationId: 'viz_9', type: 'value', pointIds: ['p1'], name: '卡' }, { configVersion: cv })
    const ev = evidenceFromRef(ref)
    assert.equal(ev.kind, 'visualization')
    assert.equal(ev.visualizationId, 'viz_9')
    assert.equal(ev.id, 'viz_9')
    assert.deepEqual(ev.pointIds, ['p1'])
    const ran = appendEvidence(home, cwd, ev)
    assert.equal(ran.ok, true, ran.error || 'ok')
    const ws = loadWorkspace(home, cwd)
    const saved = ws.focus.evidence.find((e) => e.visualizationId === 'viz_9')
    assert.ok(saved)
    assert.equal(saved.componentType, 'value')
    assert.deepEqual(saved.pointIds, ['p1'])
  } finally {
    await rm(home, { recursive: true, force: true })
  }
})

test('dispatchAgentRef 无输入桥时返回完整 JSON 文本', async () => {
  const ref = buildAgentRef('visualization', { visualizationId: 'viz_x', type: 'bar', pointIds: ['p9'] }, { configVersion: 1 })
  const res = await dispatchAgentRef(ref, { setDraft: null })
  assert.equal(res.fallback, true)
  const parsed = JSON.parse(res.text)
  assert.equal(parsed.visualizationId, 'viz_x')
  assert.deepEqual(parsed.pointIds, ['p9'])
})

test('tool schema 声明 visualizationId / evidence.visualizationId', () => {
  const tool = visionBenchTool('/tmp')
  const props = tool.parameters.properties
  assert.ok(props.target.properties.visualizationId)
  assert.ok(props.evidence.items.properties.visualizationId)
  assert.ok(props.evidence.items.properties.componentType)
  assert.ok(props.evidence.items.properties.pointIds)
})
