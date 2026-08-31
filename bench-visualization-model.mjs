// TaskP0/0.20.0: 可视化组件纯模型 — 不依赖 React / 插槽 / HTTP。
//
// 组件持久化在 modbus.visualization 下：
//   { schemaVersion: 2, columns: 12, components: [{ id, name, type, pointIds, order, settings, layout }] }
// schema v1 读入时补默认 layout，写出为 v2。modbus.version 仍为 3。
// 类型：line（1–8 个监视点位）/ bar（1–16）/ value（1）/ switch（1 个可写 FC01 点位）。
// 组件引用使用稳定 pointId；点位关闭监视或被删除时组件保留并进入 degraded 状态。
export const VISUALIZATION_SCHEMA_VERSION = 2
export const VIZ_GRID_COLUMNS = 12
export const MAX_COMPONENTS = 32
export const MAX_COMPONENT_NAME = 40
export const COMPONENT_TYPES = new Set(['line', 'bar', 'value', 'switch'])

export const COMPONENT_LIMITS = {
  line: { min: 1, max: 8 },
  bar: { min: 1, max: 16 },
  value: { min: 1, max: 1 },
  switch: { min: 1, max: 1 },
}

const vizGenId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const vizIds = (value) => {
  if (!Array.isArray(value)) return []
  const seen = new Set()
  const out = []
  for (const v of value) {
    const id = String(v || '').trim()
    if (!id || seen.has(id)) continue
    seen.add(id)
    out.push(id)
    if (out.length >= 32) break
  }
  return out
}

export const emptyVisualization = () => ({
  schemaVersion: VISUALIZATION_SCHEMA_VERSION,
  columns: VIZ_GRID_COLUMNS,
  components: [],
})

export function defaultComponentLayout(index, type) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0
  const w = type === 'line' || type === 'bar' ? 6 : 3
  const h = type === 'line' || type === 'bar' ? 4 : 3
  const x = (i * w) % VIZ_GRID_COLUMNS
  const y = Math.floor((i * w) / VIZ_GRID_COLUMNS) * h
  return { x, y, w, h }
}

export function normalizeComponentLayout(raw, index, type) {
  const src = raw && typeof raw === 'object' ? raw : {}
  const fallback = defaultComponentLayout(index, type)
  const w = vizClampInt(src.w, fallback.w, 1, VIZ_GRID_COLUMNS)
  const x = vizClampInt(src.x, fallback.x, 0, VIZ_GRID_COLUMNS - 1)
  return {
    x: Math.min(x, VIZ_GRID_COLUMNS - w),
    y: vizClampInt(src.y, fallback.y, 0, 256),
    w,
    h: vizClampInt(src.h, fallback.h, 1, 32),
  }
}

export function validateLayoutBox(raw) {
  if (!raw || typeof raw !== 'object') {
    return { ok: false, errorCode: 'LAYOUT_INVALID', error: '非法布局坐标' }
  }
  for (const key of ['x', 'y', 'w', 'h']) {
    if (!Number.isFinite(Number(raw[key]))) {
      return { ok: false, errorCode: 'LAYOUT_INVALID', error: `非法布局坐标: ${key}` }
    }
  }
  const x = Math.trunc(Number(raw.x))
  const y = Math.trunc(Number(raw.y))
  const w = Math.trunc(Number(raw.w))
  const h = Math.trunc(Number(raw.h))
  if (x < 0 || y < 0 || w < 1 || h < 1) {
    return { ok: false, errorCode: 'LAYOUT_INVALID', error: '非法布局坐标' }
  }
  if (w > VIZ_GRID_COLUMNS || x + w > VIZ_GRID_COLUMNS || h > 32 || y > 256) {
    return { ok: false, errorCode: 'LAYOUT_OUT_OF_BOUNDS', error: '布局超出网格范围' }
  }
  return { ok: true, layout: normalizeComponentLayout({ x, y, w, h }, 0, 'value') }
}

export function parseVisualizationLayoutItems(items, components) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, errorCode: 'LAYOUT_REQUIRED', error: 'layout 必须携带 items' }
  }
  const known = new Set((Array.isArray(components) ? components : []).map((c) => c && c.id).filter(Boolean))
  const seen = new Set()
  const parsed = []
  for (const item of items) {
    const id = String((item && (item.id || item.visualizationId)) || '').trim()
    if (!id) return { ok: false, errorCode: 'LAYOUT_INVALID', error: 'layout item 缺少 id' }
    if (seen.has(id)) return { ok: false, errorCode: 'LAYOUT_DUPLICATE_ID', error: `重复布局 id: ${id}` }
    seen.add(id)
    const box = item && item.layout && typeof item.layout === 'object' ? item.layout : item
    const checked = validateLayoutBox(box)
    if (!checked.ok) return checked
    parsed.push({ id, layout: checked.layout })
  }
  const missing = parsed.filter((row) => !known.has(row.id))
  if (missing.length === parsed.length) {
    return { ok: false, errorCode: 'VIZ_NOT_FOUND', error: '布局目标组件不存在' }
  }
  if (missing.length) {
    return { ok: false, errorCode: 'VIZ_NOT_FOUND', error: `组件不存在: ${missing[0].id}` }
  }
  return { ok: true, items: parsed }
}

const vizClampInt = (v, fallback, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

export const normalizeVisualizationComponent = (input, index = 0) => {
  const raw = input && typeof input === 'object' ? input : {}
  const type = COMPONENT_TYPES.has(raw.type) ? raw.type : 'line'
  const id = String(raw.id || '').trim() || vizGenId('viz_')
  const name =
    String(raw.name || '')
      .trim()
      .slice(0, MAX_COMPONENT_NAME) || '未命名组件'
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {}
  const windowMs = vizClampInt(settings.windowMs, 300000, 10000, 3600000)
  return {
    id,
    name,
    type,
    pointIds: vizIds(raw.pointIds),
    order: vizClampInt(raw.order, 0, 0, 1024),
    settings: {
      windowMs,
      confirmWrite: settings.confirmWrite !== false,
    },
    layout: normalizeComponentLayout(raw.layout, index, type),
  }
}

export const normalizeVisualization = (input, points) => {
  const src = input && typeof input === 'object' ? input : {}
  const components = Array.isArray(src.components) ? src.components : []
  const seen = new Set()
  const out = []
  for (const raw of components) {
    const c = normalizeVisualizationComponent(raw, out.length)
    if (seen.has(c.id)) continue
    seen.add(c.id)
    out.push(c)
    if (out.length >= MAX_COMPONENTS) break
  }
  void points
  return { schemaVersion: VISUALIZATION_SCHEMA_VERSION, columns: VIZ_GRID_COLUMNS, components: out }
}

// 校验：类型数量限制、switch 只接受可写 FC01 监视点位、只关联已监视点位。
export const validateVisualizationComponent = (component, points) => {
  const c = component || {}
  const type = c.type || 'line'
  const limit = COMPONENT_LIMITS[type] || COMPONENT_LIMITS.line
  const ids = vizIds(c.pointIds)
  if (!ids.length) return { ok: false, error: '请至少关联一个已监视点位' }
  if (ids.length < limit.min || ids.length > limit.max) {
    return {
      ok: false,
      error: '组件类型 ' + type + ' 需要 ' + limit.min + '–' + limit.max + ' 个点位，当前 ' + ids.length,
    }
  }
  const byId = new Map((Array.isArray(points) ? points : []).map((p) => [p.id, p]))
  const notMonitored = []
  const unsupported = []
  // Task11/0.20.1: 类型-功能码 约束（line/bar 仅数值型 FC03/04；value 任意；switch 仅 FC01）
  const numericFn = (fn) => fn === 3 || fn === 4
  for (const pid of ids) {
    const pt = byId.get(pid)
    if (!pt) {
      notMonitored.push(pid)
      continue
    }
    if (pt.monitorEnabled !== true) notMonitored.push(pid)
    if ((type === 'line' || type === 'bar') && !numericFn(pt.function)) unsupported.push(pid)
    if (type === 'switch' && pt.function !== 1) unsupported.push(pid)
    if (type === 'value' && ![1, 2, 3, 4].includes(pt.function)) unsupported.push(pid)
  }
  if (unsupported.length) {
    return {
      ok: false,
      error: '组件类型不支持这些点位功能码: ' + unsupported.join(', '),
      errorCode: 'VIZ_POINT_TYPE_UNSUPPORTED',
    }
  }
  if (notMonitored.length) return { ok: false, error: '以下点位未开启监视: ' + notMonitored.join(', ') }
  return { ok: true }
}

// 组件运行状态：ok / degraded（缺失点位或点位关闭监视）/ limited
export const visualizationComponentStatus = (component, points) => {
  const c = component || {}
  const byId = new Map((Array.isArray(points) ? points : []).map((p) => [p.id, p]))
  const ids = vizIds(c.pointIds)
  if (!ids.length) return 'degraded'
  const dead = ids.filter((pid) => {
    const pt = byId.get(pid)
    return !pt || pt.monitorEnabled !== true
  })
  if (dead.length) return 'degraded'
  const missing = ids.filter((pid) => !byId.get(pid))
  if (missing.length) return 'degraded'
  return 'ok'
}

// 组件编辑器的可选数据源：只列 monitorEnabled 点位，限定路径 连接/设备/点位。
export const monitoredPointOptions = (pack) => {
  const conns = new Map(((pack && pack.connections) || []).map((c) => [c.id, c]))
  const devs = new Map(((pack && pack.devices) || []).map((d) => [d.id, d]))
  const values = new Map(((pack && pack.values) || []).map((v) => [v.key || v.pointId, v]))
  const out = []
  for (const p of (pack && pack.points) || []) {
    if (p.monitorEnabled !== true) continue
    const conn = conns.get(p.connectionId)
    const dev = devs.get(p.deviceId)
    const rec = values.get(p.id)
    out.push({
      pointId: p.id,
      name: p.name || String(p.id),
      connectionId: p.connectionId,
      deviceId: p.deviceId,
      path:
        ((conn && conn.name) || p.connectionId) +
        ' / ' +
        ((dev && dev.name) || p.deviceId) +
        ' / ' +
        (p.name || p.address),
      function: p.function,
      address: p.address,
      unit: p.unit || '',
      value: rec ? rec.value : null,
      ok: rec ? rec.ok !== false : false,
    })
  }
  return out
}

export const componentUsesPoint = (component, pointId) =>
  !!(component && Array.isArray(component.pointIds) && component.pointIds.includes(pointId))

export const findComponent = (visualization, id) => {
  const viz = visualization && typeof visualization === 'object' ? visualization : {}
  return (Array.isArray(viz.components) ? viz.components : []).find((c) => c && c.id === id) || null
}
/** 对齐 modbusWrite 返回：outcomeUnknown / ok / readback[] */
export function formatSwitchWriteNote(data, wantOn) {
  const target = wantOn ? '开' : '关'
  if (!data || data.ok === false) {
    if (data && (data.outcomeUnknown || data.unknown)) return '目标 ' + target + ' → 回读未知 → 结果未知'
    const rbRaw = data && data.readback
    const hasRb = Array.isArray(rbRaw) ? rbRaw.length > 0 : rbRaw != null
    if (data && hasRb) {
      const rb = Array.isArray(rbRaw) ? rbRaw[0] : rbRaw
      return '目标 ' + target + ' → 回读 ' + String(rb) + ' → 不一致'
    }
    return data && data.error ? data.error : '写入失败'
  }
  if (data.outcomeUnknown || data.unknown) return '目标 ' + target + ' → 回读未知 → 结果未知'
  const rbRaw = data.readback
  const rb = Array.isArray(rbRaw)
    ? rbRaw.length
      ? rbRaw[0]
      : '—'
    : rbRaw != null
      ? rbRaw
      : data.value != null
        ? data.value
        : '—'
  return '目标 ' + target + ' → 回读 ' + String(rb) + ' → 一致'
}
