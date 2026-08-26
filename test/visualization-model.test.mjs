// TaskP0/0.20.0: 可视化组件纯模型 — 类型规范、数量限制、监视资格、degraded 语义。
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  COMPONENT_LIMITS,
  componentUsesPoint,
  emptyVisualization,
  findComponent,
  monitoredPointOptions,
  normalizeVisualization,
  normalizeVisualizationComponent,
  validateVisualizationComponent,
  visualizationComponentStatus,
} from '../bench-visualization-model.mjs'

const pts = (list) => list.map((p, i) => ({
  id: p.id || ('p' + (i + 1)),
  connectionId: p.connectionId || 'c1',
  deviceId: p.deviceId || 'd1',
  name: p.name || ('点' + (i + 1)),
  function: p.function || 3,
  address: p.address !== undefined ? p.address : i,
  monitorEnabled: p.monitorEnabled !== false,
  alarmEnabled: p.alarmEnabled === true,
  alarmMin: p.alarmMin ?? null,
  alarmMax: p.alarmMax ?? null,
}))

test('四类组件规范化和数量限制（line/bar/value/switch）', () => {
  const byId = {}
  for (const type of ['line', 'bar', 'value', 'switch']) {
    const lim = COMPONENT_LIMITS[type]
    const c = normalizeVisualizationComponent({ id: 'x', type, name: 'n', pointIds: Array.from({ length: lim.max }, (_, i) => 'p' + i) })
    byId[type] = c
    assert.equal(c.type, type)
    assert.equal(c.pointIds.length, lim.max)
  }
  // 超限截断：line 传入 12 → 规范化只保留? 模型不截断数量，validate 拒绝
  const tooMany = normalizeVisualizationComponent({ id: 'y', type: 'line', pointIds: Array.from({ length: 12 }, (_, i) => 'p' + i) })
  const v = validateVisualizationComponent(tooMany, pts(Array.from({ length: 12 }, (_, i) => ({ id: 'p' + i }))))
  assert.equal(v.ok, false, '超过 8 条序列被拒绝')
  const okSmall = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'line', pointIds: ['p1', 'p2'] }), pts([{ id: 'p1' }, { id: 'p2' }]))
  assert.equal(okSmall.ok, true)
})

test('非监视点位不可新关联（validate 拒绝）', () => {
  const points = pts([{ id: 'p1', monitorEnabled: true }, { id: 'p2', monitorEnabled: false }])
  const c = normalizeVisualizationComponent({ type: 'value', pointIds: ['p2'] })
  const v = validateVisualizationComponent(c, points)
  assert.equal(v.ok, false)
  assert.ok(v.error.includes('未开启监视'), v.error)
  // 已存在的旧组件引用关闭监视点位 → 不删除，只 degraded
  const c2 = normalizeVisualizationComponent({ id: 'keep', type: 'value', pointIds: ['p2'] })
  assert.equal(visualizationComponentStatus(c2, points), 'degraded')
  const viz = normalizeVisualization({ components: [c2] }, points)
  assert.equal(viz.components.length, 1, '组件保留')
})

test('删除点位只产生 degraded，不自动删除组件', () => {
  const points = pts([{ id: 'p1' }])
  const c = normalizeVisualizationComponent({ id: 'gone', type: 'value', pointIds: ['p1', 'pX'] })
  assert.equal(visualizationComponentStatus(c, points), 'degraded')
  assert.equal(c.pointIds.length, 2, '引用保留')
  assert.equal(findComponent(normalizeVisualization({ components: [c] }), 'gone').id, 'gone')
})

test('switch 只接受 FC01 可写线圈点位', () => {
  const points = pts([{ id: 'coil', function: 1 }, { id: 'hr', function: 3 }, { id: 'di', function: 2 }])
  const ok = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'switch', pointIds: ['coil'] }), points)
  assert.equal(ok.ok, true, ok.error || '')
  const bad = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'switch', pointIds: ['hr'] }), points)
  assert.equal(bad.ok, false)
  assert.equal(bad.errorCode, 'VIZ_POINT_TYPE_UNSUPPORTED', bad.error)
  const bad2 = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'switch', pointIds: ['di'] }), points)
  assert.equal(bad2.ok, false)
})

test('组件 ID/名称/pointIds/settings 边界', () => {
  const c = normalizeVisualizationComponent({ name: 'x'.repeat(90), pointIds: ['a', 'a', 'b', ''], settings: { windowMs: 5, confirmWrite: false } })
  assert.ok(c.name.length <= 40, '名称截断 40')
  assert.deepEqual(c.pointIds, ['a', 'b'], 'pointIds 去重且忽略空串')
  assert.equal(c.settings.windowMs, 10000, 'windowMs 钳制下限')
  assert.equal(c.settings.confirmWrite, false)
  const def = normalizeVisualizationComponent({})
  assert.equal(def.id.startsWith('viz_'), true, '无 ID 自动生成')
  assert.equal(def.type, 'line')
  assert.equal(def.settings.windowMs, 300000)
  assert.equal(def.settings.confirmWrite, true)
})

test('monitoredPointOptions 只列监视点位并带限定路径', () => {
  const pack = {
    connections: [{ id: 'c1', name: 'C1' }, { id: 'c2', name: 'C2' }],
    devices: [{ id: 'd1', connectionId: 'c1', name: '设备1' }, { id: 'd2', connectionId: 'c1', name: '设备2' }],
    points: pts([
      { id: 'p1', connectionId: 'c1', deviceId: 'd1', name: '温度' },
      { id: 'p2', connectionId: 'c1', deviceId: 'd2', name: '压力', monitorEnabled: false },
      { id: 'p3', connectionId: 'c1', deviceId: 'd1', name: '开关', function: 1 },
    ]),
    values: [{ key: 'p1', value: 23.5 }],
  }
  const opts = monitoredPointOptions(pack)
  assert.deepEqual(opts.map((o) => o.pointId), ['p1', 'p3'], '只列监视点位')
  assert.ok(opts[0].path.includes('C1') && opts[0].path.includes('设备1') && opts[0].path.includes('温度'), '限定路径: ' + opts[0].path)
  assert.equal(opts[0].value, 23.5)
  assert.equal(opts[1].function, 1)
})

test('emptyVisualization / componentUsesPoint', () => {
  const v = emptyVisualization()
  assert.equal(v.schemaVersion, 1)
  assert.deepEqual(v.components, [])
  assert.equal(componentUsesPoint({ pointIds: ['p1', 'p2'] }, 'p2'), true)
  assert.equal(componentUsesPoint({ pointIds: ['p1'] }, 'pX'), false)
})
test('Task11/0.20.1: 组件类型-功能码约束（line/bar 仅数值型，value 任意，switch 仅 FC01）', () => {
  const allPts = pts([
    { id: 'coil', function: 1 }, { id: 'di', function: 2 }, { id: 'hr', function: 3 }, { id: 'ir', function: 4 },
  ])
  // line/bar: FC01/02 拒绝
  for (const type of ['line', 'bar']) {
    const bad = validateVisualizationComponent(normalizeVisualizationComponent({ type, pointIds: ['coil'] }), allPts)
    assert.equal(bad.ok, false)
    assert.equal(bad.errorCode, 'VIZ_POINT_TYPE_UNSUPPORTED')
    const bad2 = validateVisualizationComponent(normalizeVisualizationComponent({ type, pointIds: ['di'] }), allPts)
    assert.equal(bad2.ok, false)
    const ok3 = validateVisualizationComponent(normalizeVisualizationComponent({ type, pointIds: ['hr'] }), allPts)
    assert.equal(ok3.ok, true)
    const ok4 = validateVisualizationComponent(normalizeVisualizationComponent({ type, pointIds: ['ir'] }), allPts)
    assert.equal(ok4.ok, true)
  }
  // value 可显示任意（含布尔线圈）
  const v = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'value', pointIds: ['coil'] }), allPts)
  assert.equal(v.ok, true)
  // switch 仅 FC01
  const sOk = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'switch', pointIds: ['coil'] }), allPts)
  assert.equal(sOk.ok, true)
  const sBad = validateVisualizationComponent(normalizeVisualizationComponent({ type: 'switch', pointIds: ['hr'] }), allPts)
  assert.equal(sBad.ok, false)
  assert.equal(sBad.errorCode, 'VIZ_POINT_TYPE_UNSUPPORTED')
})
