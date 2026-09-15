// @ts-check
// Visualization component model (schema v2). Pure domain — no React / HTTP.
export const VISUALIZATION_SCHEMA_VERSION = 2
export const VISUALIZATION_MINIMUM_PLUGIN_VERSION = '0.25.1'
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

/** @param {any} [prefix] @returns {any} */
const vizGenId = (prefix) => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

/** @param {any} [value] @returns {any} */
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
  minimumPluginVersion: VISUALIZATION_MINIMUM_PLUGIN_VERSION,
  columns: VIZ_GRID_COLUMNS,
  components: [],
})

/**
 * @param {any} [a]
 * @param {any} [b]
 * @returns {any}
 */
function cmpPluginVersion(a, b) {
  const pa = String(a || '0')
    .split('.')
    .map((/** @type {any} */ n) => parseInt(n, 10) || 0)
  const pb = String(b || '0')
    .split('.')
    .map((/** @type {any} */ n) => parseInt(n, 10) || 0)
  for (let i = 0; i < Math.max(pa.length, pb.length); i++) {
    const d = (pa[i] || 0) - (pb[i] || 0)
    if (d) return d
  }
  return 0
}

/**
 * @param {any} [input]
 * @returns {any}
 */
export function visualizationSchemaGuard(input) {
  const src = input && typeof input === 'object' ? input : {}
  const ver = Number(src.schemaVersion) || 1
  if (ver > VISUALIZATION_SCHEMA_VERSION) {
    return {
      ok: false,
      errorCode: 'VIZ_SCHEMA_UNSUPPORTED',
      error: `不支持的可视化 schemaVersion ${ver}，当前只读`,
    }
  }
  const min = String(src.minimumPluginVersion || '').trim()
  if (min && cmpPluginVersion(min, VISUALIZATION_MINIMUM_PLUGIN_VERSION) > 0) {
    return {
      ok: false,
      errorCode: 'VIZ_SCHEMA_UNSUPPORTED',
      error: `需要插件 ${min} 或更高，当前只读`,
    }
  }
  return { ok: true, schemaVersion: ver }
}

/**
 * @param {any} [src]
 * @returns {any}
 */
function componentsForRead(src) {
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
  return out
}

/** Read path: keep v1 on disk shape, only fill in-memory layouts. Never writes schemaVersion 2.
 * @param {any} [input]
 * @param {any} [points]
 * @returns {any}
 */
export function normalizeVisualizationForRead(input, points) {
  void points
  const src = input && typeof input === 'object' ? input : {}
  const guard = visualizationSchemaGuard(src)
  if (!guard.ok) {
    return {
      schemaVersion: Number(src.schemaVersion) || 1,
      minimumPluginVersion: src.minimumPluginVersion || '',
      columns: Number(src.columns) || VIZ_GRID_COLUMNS,
      components: Array.isArray(src.components) ? src.components : [],
      unsupported: true,
      errorCode: guard.errorCode,
      error: guard.error,
    }
  }
  const components = componentsForRead(src)
  if (guard.schemaVersion <= 1) {
    return { schemaVersion: 1, components }
  }
  return {
    schemaVersion: VISUALIZATION_SCHEMA_VERSION,
    minimumPluginVersion: src.minimumPluginVersion || VISUALIZATION_MINIMUM_PLUGIN_VERSION,
    columns: VIZ_GRID_COLUMNS,
    components,
  }
}

/** Explicit config write path: v1 → v2 with columns and minimumPluginVersion.
 * @param {any} [input]
 * @param {any} [points]
 * @returns {any}
 */
export function migrateVisualizationToV2(input, points) {
  const src = input && typeof input === 'object' ? input : {}
  const guard = visualizationSchemaGuard(src)
  if (!guard.ok) return { ok: false, errorCode: guard.errorCode, error: guard.error }
  const read = normalizeVisualizationForRead(src, points)
  return {
    schemaVersion: VISUALIZATION_SCHEMA_VERSION,
    minimumPluginVersion: VISUALIZATION_MINIMUM_PLUGIN_VERSION,
    columns: VIZ_GRID_COLUMNS,
    components: read.components || [],
  }
}

/**
 * @param {any} [index]
 * @param {any} [type]
 * @returns {any}
 */
export function defaultComponentLayout(index, type) {
  const i = Number.isInteger(index) && index >= 0 ? index : 0
  const w = type === 'line' || type === 'bar' ? 6 : 3
  const h = type === 'line' || type === 'bar' ? 4 : 3
  const x = (i * w) % VIZ_GRID_COLUMNS
  const y = Math.floor((i * w) / VIZ_GRID_COLUMNS) * h
  return { x, y, w, h }
}

/**
 * @param {any} [raw]
 * @param {any} [index]
 * @param {any} [type]
 * @returns {any}
 */
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

/**
 * @param {any} [raw]
 * @returns {any}
 */
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

/**
 * @param {any} items
 * @param {any} components
 * @returns {{ ok: true, items: { id: string, layout: { x: number, y: number, w: number, h: number } }[] } | { ok: false, errorCode: string, error: string }}
 */
export function parseVisualizationLayoutItems(items, components) {
  if (!Array.isArray(items) || items.length === 0) {
    return { ok: false, errorCode: 'LAYOUT_REQUIRED', error: 'layout 必须携带 items' }
  }
  const known = new Set(
    (Array.isArray(components) ? components : []).map((/** @type {any} */ c) => c && c.id).filter(Boolean),
  )
  const seen = new Set()
  /** @type {{ id: string, layout: { x: number, y: number, w: number, h: number } }[]} */
  const parsed = []
  for (const item of items) {
    const id = String((item && (item.id || item.visualizationId)) || '').trim()
    if (!id) return { ok: false, errorCode: 'LAYOUT_INVALID', error: 'layout item 缺少 id' }
    if (seen.has(id)) return { ok: false, errorCode: 'LAYOUT_DUPLICATE_ID', error: `重复布局 id: ${id}` }
    seen.add(id)
    const box = item && item.layout && typeof item.layout === 'object' ? item.layout : item
    const checked = validateLayoutBox(box)
    if (!checked.ok) return { ok: false, errorCode: checked.errorCode, error: checked.error }
    parsed.push({ id, layout: checked.layout })
  }
  const missing = parsed.filter((/** @type {any} */ row) => !known.has(row.id))
  if (missing.length === parsed.length) {
    return { ok: false, errorCode: 'VIZ_NOT_FOUND', error: '布局目标组件不存在' }
  }
  if (missing.length) {
    return { ok: false, errorCode: 'VIZ_NOT_FOUND', error: `组件不存在: ${missing[0].id}` }
  }
  return { ok: true, items: parsed }
}

/**
 * @param {any} [v]
 * @param {any} [fallback]
 * @param {any} [min]
 * @param {any} [max]
 * @returns {any}
 */
const vizClampInt = (v, fallback, min, max) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

/**
 * @param {any} [v]
 * @param {any} [min]
 * @returns {any}
 */
const vizNum = (v, min) =>
  v != null && v !== '' && Number.isFinite(Number(v)) && (min === undefined || Number(v) > min) ? Number(v) : undefined

/**
 * @param {any} [input]
 * @param {any} [index]
 * @returns {any}
 */
export const normalizeVisualizationComponent = (input, index = 0) => {
  const raw = input && typeof input === 'object' ? input : {}
  const type = COMPONENT_TYPES.has(raw.type) ? raw.type : 'line'
  const id = String(raw.id || '').trim() || vizGenId('viz_')
  const name =
    String(raw.name || '')
      .trim()
      .slice(0, MAX_COMPONENT_NAME) || '未命名组件'
  const settings = raw.settings && typeof raw.settings === 'object' ? raw.settings : {}
  const cleanSettings = /** @type {Record<string, any>} */ ({})
  for (const [k, v] of Object.entries(settings)) {
    if (v === '' || v == null || ['yMin', 'yMax', 'yInterval', 'yUnit'].includes(k)) continue
    cleanSettings[k] = /Number|Length|Split|Size$/.test(k) && Number.isFinite(Number(v)) ? Number(v) : v
  }
  const windowMs = vizClampInt(settings.windowMs, 300000, 10000, 3600000)
  return {
    id,
    name,
    type,
    pointIds: vizIds(raw.pointIds),
    order: vizClampInt(raw.order, 0, 0, 1024),
    settings: {
      ...cleanSettings,
      windowMs,
      confirmWrite: settings.confirmWrite !== false,
      ...(vizNum(settings.yMin) != null ? { yMin: vizNum(settings.yMin) } : {}),
      ...(vizNum(settings.yMax) != null ? { yMax: vizNum(settings.yMax) } : {}),
      ...(vizNum(settings.yInterval, 0) != null ? { yInterval: vizNum(settings.yInterval, 0) } : {}),
      ...(settings.yUnit ? { yUnit: String(settings.yUnit).trim().slice(0, 16) } : {}),
      ...(settings.showGrid !== undefined ? { showGrid: settings.showGrid !== false } : {}),
      ...(settings.smooth !== undefined ? { smooth: settings.smooth !== false } : {}),
      ...(settings.showLegend !== undefined ? { showLegend: settings.showLegend !== false } : {}),
    },
    layout: normalizeComponentLayout(raw.layout, index, type),
  }
}

/** @deprecated Use normalizeVisualizationForRead for loads and migrateVisualizationToV2 for writes.
 * @param {any} [input]
 * @param {any} [points]
 * @returns {any}
 */
export const normalizeVisualization = (input, points) => normalizeVisualizationForRead(input, points)

// 校验：类型数量限制、switch 只接受可写 FC01 监视点位、只关联已监视点位。
/**
 * @param {any} [component]
 * @param {any} [points]
 * @returns {any}
 */
export const validateVisualizationComponent = (component, points) => {
  const c = component || {}
  const type = c.type || 'line'
  const limit = /** @type {Record<string, { min: number, max: number }>} */ (COMPONENT_LIMITS)[type] || COMPONENT_LIMITS.line
  const ids = vizIds(c.pointIds)
  if (!ids.length) return { ok: false, error: '请至少关联一个已监视点位' }
  if (ids.length < limit.min || ids.length > limit.max) {
    return {
      ok: false,
      error: '组件类型 ' + type + ' 需要 ' + limit.min + '–' + limit.max + ' 个点位，当前 ' + ids.length,
    }
  }
  const byId = new Map((Array.isArray(points) ? points : []).map((/** @type {any} */ p) => [p.id, p]))
  const notMonitored = []
  const unsupported = []
  // Task11/0.20.1: 类型-功能码 约束（line/bar 仅数值型 FC03/04；value 任意；switch 仅 FC01）
  /**
   * @param {any} [fn]
   * @returns {any}
   */
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
  if (
    c.settings &&
    c.settings.yMin != null &&
    c.settings.yMax != null &&
    Number(c.settings.yMin) >= Number(c.settings.yMax)
  ) {
    return { ok: false, error: 'Y轴最小值必须小于最大值' }
  }
  if (
    c.settings &&
    c.settings.yInterval != null &&
    (Number(c.settings.yInterval) <= 0 || !Number.isFinite(Number(c.settings.yInterval)))
  ) {
    return { ok: false, error: 'Y轴刻度必须为大于0的数字' }
  }
  return { ok: true }
}

// 组件运行状态：ok / degraded（缺失点位或点位关闭监视）/ limited
/**
 * @param {any} [component]
 * @param {any} [points]
 * @returns {any}
 */
export const visualizationComponentStatus = (component, points) => {
  const c = component || {}
  const byId = new Map((Array.isArray(points) ? points : []).map((/** @type {any} */ p) => [p.id, p]))
  const ids = vizIds(c.pointIds)
  if (!ids.length) return 'degraded'
  const dead = ids.filter((/** @type {any} */ pid) => {
    const pt = byId.get(pid)
    return !pt || pt.monitorEnabled !== true
  })
  if (dead.length) return 'degraded'
  const missing = ids.filter((/** @type {any} */ pid) => !byId.get(pid))
  if (missing.length) return 'degraded'
  return 'ok'
}

// 组件编辑器的可选数据源：只列 monitorEnabled 点位，限定路径 连接/设备/点位。
/**
 * @param {any} [pack]
 * @returns {any}
 */
export const monitoredPointOptions = (pack) => {
  const conns = new Map(((pack && pack.connections) || []).map((/** @type {any} */ c) => [c.id, c]))
  const devs = new Map(((pack && pack.devices) || []).map((/** @type {any} */ d) => [d.id, d]))
  const values = new Map(((pack && pack.values) || []).map((/** @type {any} */ v) => [v.key || v.pointId, v]))
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
      deviceName: (dev && dev.name) || p.deviceId || '',
      connectionName: (conn && conn.name) || p.connectionId || '',
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

/**
 * @param {any} [component]
 * @param {any} [pointId]
 * @returns {any}
 */
export const componentUsesPoint = (component, pointId) =>
  !!(component && Array.isArray(component.pointIds) && component.pointIds.includes(pointId))

/**
 * @param {any} [visualization]
 * @param {any} [id]
 * @returns {any}
 */
export const findComponent = (visualization, id) => {
  const viz = visualization && typeof visualization === 'object' ? visualization : {}
  return (Array.isArray(viz.components) ? viz.components : []).find((/** @type {any} */ c) => c && c.id === id) || null
}
/** 对齐 modbusWrite 返回：outcomeUnknown / ok / readback[]
 * @param {any} [data]
 * @param {any} [wantOn]
 * @returns {any}
 */
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
