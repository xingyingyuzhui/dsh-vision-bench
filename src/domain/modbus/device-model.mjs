// @ts-check

const devText = (/** @type {any} */ v, fb = '') => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || fb
}

const genId = (/** @type {string} */ prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

/** Modbus Unit ID：合法范围为 1..247（不含广播 0）。非法返回 null，禁止静默纠正。
 * @param {any} value
 * @returns {number | null}
 */
export const parseUnitId = (value) => {
  const n = Math.trunc(Number(value))
  return Number.isFinite(n) && n >= 1 && n <= 247 ? n : null
}

/**
 * @param {any} [input]
 * @param {string} [fallbackConnId]
 */
export const normalizeDevice = (input, fallbackConnId) => {
  const raw = input && typeof input === 'object' ? input : {}
  const id = devText(raw.id, '') || genId('d')
  const connectionId = devText(raw.connectionId, '') || devText(raw.connId, '') || fallbackConnId || 'c1'
  const name = devText(raw.name, '') || '设备1'
  const hasUnit = raw.unitId !== undefined || raw.unit !== undefined || raw.slave !== undefined
  const unitRaw =
    raw.unitId !== undefined ? raw.unitId : raw.unit !== undefined ? raw.unit : raw.slave !== undefined ? raw.slave : 1
  // 缺省默认 1；显式非法值在 validateDevices 拒绝，加载时钳到 1..247（不保留 0）
  const unitId = hasUnit ? (parseUnitId(unitRaw) ?? 1) : 1
  return {
    id,
    connectionId,
    name: name.slice(0, 40),
    unitId,
    enabled: raw.enabled !== false,
  }
}

/**
 * @param {any} list
 * @param {any[]} [connections]
 */
export const normalizeDevices = (list, connections) => {
  if (!Array.isArray(list)) {
    const first = Array.isArray(connections) && connections[0] ? connections[0].id : 'c1'
    return [normalizeDevice({ id: 'd1', connectionId: first, unitId: 1 }, first)]
  }
  const validConnIds = new Set((connections || []).map((c) => c.id))
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const d = normalizeDevice(raw, Array.isArray(connections) && connections[0] ? connections[0].id : 'c1')
    // fix invalid connectionId to first
    if (!validConnIds.has(d.connectionId)) {
      d.connectionId = Array.isArray(connections) && connections[0] ? connections[0].id : 'c1'
    }
    if (seen.has(d.id)) continue
    seen.add(d.id)
    out.push(d)
    if (out.length >= 64) break
  }
  if (!out.length) {
    const first = Array.isArray(connections) && connections[0] ? connections[0].id : 'c1'
    out.push(normalizeDevice({ id: 'd1', connectionId: first, unitId: 1 }, first))
  }
  return out
}

/**
 * @param {any[]} devices
 * @param {any[]} [connections]
 * @returns {string[]}
 */
export const validateDevices = (devices, connections) => {
  /** @type {string[]} */
  const errors = []
  if (!Array.isArray(devices) || !devices.length) return errors
  const connEnabled = new Map()
  if (Array.isArray(connections)) {
    for (const c of connections) if (c?.id) connEnabled.set(c.id, c.enabled !== false)
  }
  const enabledDevices = devices.filter((d) => d && d.enabled !== false)
  const byConn = new Map()
  for (const d of enabledDevices) {
    const cid = d.connectionId || 'c1'
    if (connEnabled.has(cid) && connEnabled.get(cid) === false) continue
    const unit = parseUnitId(d.unitId)
    if (unit == null) {
      errors.push(`Unit ID 必须是 1..247（设备 ${d.name || d.id}，不支持广播 0）`)
      continue
    }
    if (!byConn.has(cid)) byConn.set(cid, new Map())
    const unitMap = byConn.get(cid)
    if (unitMap.has(unit)) {
      const other = unitMap.get(unit)
      errors.push(`同一连接下 Unit ID 重复: ${unit}（${other.name} 与 ${d.name} 在 ${cid}）`)
    } else {
      unitMap.set(unit, d)
    }
  }
  return errors
}

/**
 * @param {any} [input]
 */
export const emptyDevice = (input = {}) => ({
  id: input.id || 'd-legacy',
  name: input.name || '设备',
  role: input.role || 'master',
  mode: input.mode || 'rtu',
  port: input.port || '',
  slave: input.slave || 1,
  segments: input.segments || [],
  values: input.values || [],
})

/**
 * @param {any} modbus
 * @param {any} spec
 */
export const addDevice = (modbus, spec) => {
  return { devices: [...(modbus.devices || []), { id: 'd-new', ...spec }], activeId: modbus.conn ? 'd-new' : '' }
}

/**
 * @param {any} modbus
 * @param {string} id
 */
export const removeDevice = (modbus, id) => {
  return { devices: (modbus.devices || []).filter((/** @type {any} */ d) => d.id !== id) }
}

/**
 * @param {any} modbus
 * @param {any} patch
 */
export const patchActiveDevice = (modbus, patch) => {
  return { ...modbus, ...patch }
}
