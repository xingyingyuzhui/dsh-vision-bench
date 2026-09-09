// @ts-check
import { decodeValue, isWritableFunction, pointIdOf } from './point-math.mjs'

export { pointIdOf, isWritableFunction, decodeValue }

export const MAX_POINTS = 256
export const MAX_VALUES = 512
export const MAX_VALUES_SAFE = 512

export const FUNCTIONS = new Set([1, 2, 3, 4])
export const FN_TAG = /** @type {Record<number, string>} */ ({ 1: '01', 2: '02', 3: '03', 4: '04' })
export const VALID_AREAS = new Set(['coil', 'discreteInput', 'holdingRegister', 'inputRegister'])
export const AREA_BY_FN = /** @type {Record<number, string>} */ ({
  1: 'coil',
  2: 'discreteInput',
  3: 'holdingRegister',
  4: 'inputRegister',
})
export const FN_BY_AREA = /** @type {Record<string, number>} */ ({
  coil: 1,
  discreteInput: 2,
  holdingRegister: 3,
  inputRegister: 4,
})
export const FALLBACK_NAME_TAG = /** @type {Record<number, string>} */ ({
  1: '线圈',
  2: '离散量',
  3: '寄存器',
  4: '输入',
})

const devText = (/** @type {any} */ v, fb = '') => {
  const s = typeof v === 'string' ? v.trim() : ''
  return s || fb
}

const genId = (/** @type {string} */ prefix) =>
  prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 8)

const devClampInt = (/** @type {any} */ v, fb = 0, min = 0, max = 65535) => {
  const n = Number(v)
  if (!Number.isFinite(n)) return fb
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

export const text = (/** @type {any} */ value, fallback = '') => {
  const out = typeof value === 'string' ? value.trim() : ''
  return out || fallback || ''
}

export const clampInt = (/** @type {any} */ value, fallback = 0, min = 0, max = 65535) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

export const clockOf = (/** @type {any} */ ms) => {
  const d = new Date(Number(ms) || Date.now())
  const pad = (/** @type {number} */ n) => String(n).padStart(2, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

export const functionTag = (/** @type {any} */ fn) =>
  FN_TAG[fn] || (Number.isFinite(Number(fn)) ? String(fn).padStart(2, '0') : '03')

/** 点位表功能码显示：01 / 02 / 03 / 04（两位数字） */
export const functionCodeOf = (/** @type {any} */ fn) => {
  const n = Math.trunc(Number(fn))
  if (!FUNCTIONS.has(n)) return '03'
  return String(n).padStart(2, '0')
}

export const WRITE_TARGET_OF = /** @type {Record<number, any>} */ ({
  1: { single: 5, multi: 15, kind: 'coil', maxMulti: 1968 },
  3: { single: 6, multi: 16, kind: 'register', maxMulti: 123 },
})

export const writeTargetOf = (/** @type {any} */ fn) => {
  const target = WRITE_TARGET_OF[Number(fn)]
  return target ? { writable: true, ...target } : { writable: false, single: 0, multi: 0, kind: '', maxMulti: 0 }
}

const finiteOrNull = (/** @type {any} */ value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/** @param {any} input */
export const normalizePoint = (input) => {
  const raw = input && typeof input === 'object' ? input : {}
  const fnRaw = Number(raw.function ?? raw.fn)
  const fn = FUNCTIONS.has(fnRaw) ? fnRaw : 3
  const addrRaw = clampInt(raw.address, 0, 0, 65535)
  const scaleRaw = Number(raw.scale)
  const scale = Number.isFinite(scaleRaw) ? scaleRaw : 1
  const offsetRaw = Number(raw.offset)
  const offset = Number.isFinite(offsetRaw) ? offsetRaw : 0
  const fallbackName = `${FALLBACK_NAME_TAG[fn] || '点位'}_${addrRaw}`
  const name = text(raw.name, '').slice(0, 40)
  const unit = text(raw.unit, '').slice(0, 12)
  const min = finiteOrNull(raw.alarmMin)
  const max = finiteOrNull(raw.alarmMax)
  const point = {
    id: text(raw.id, '') || pointIdOf(fn, addrRaw),
    name: name || fallbackName,
    function: fn,
    address: addrRaw,
    scale,
    offset,
    unit,
    monitorEnabled: raw.monitorEnabled !== undefined ? raw.monitorEnabled === true : raw.trendEnabled === true,
    alarmEnabled: raw.alarmEnabled !== undefined ? raw.alarmEnabled === true : min != null || max != null,
    trendEnabled: raw.monitorEnabled !== undefined ? raw.monitorEnabled === true : raw.trendEnabled === true,
    alarmMin: min,
    alarmMax: max,
  }
  return point
}

/** @param {any} list */
export const normalizePoints = (list) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const p = normalizePoint(raw)
    const key = `${p.function}:${p.address}`
    if (seen.has(key)) continue
    seen.add(key)
    out.push(p)
    if (out.length >= MAX_POINTS) break
  }
  return out
}

export const pointLabel = (/** @type {any} */ point) =>
  point ? (point.name ? `${point.name} (${point.id})` : point.id) : ''

export const findPoint = (/** @type {any[]} */ points, /** @type {number} */ fn, /** @type {number} */ address) =>
  (points || []).find((p) => p && p.function === fn && p.address === address) || null

/**
 * @param {number} fn
 * @param {any} input
 * @param {number} [maxCount]
 */
export const normalizeWriteValues = (fn, input, maxCount) => {
  const target = writeTargetOf(fn)
  if (!target.writable) {
    return { ok: false, error: '该功能码只读，不能写入' }
  }
  const list = Array.isArray(input) ? input : [input]
  if (!list.length) return { ok: false, error: '缺少写入值' }
  if (list.length > Math.min(target.maxMulti, maxCount || target.maxMulti)) {
    return { ok: false, error: '写入数量超出上限' }
  }
  const values = []
  for (const item of list) {
    const n = typeof item === 'boolean' ? (item ? 1 : 0) : Number(item)
    if (!Number.isInteger(n)) {
      return { ok: false, error: '写入值必须是整数' }
    }
    if (target.kind === 'coil') {
      if (n !== 0 && n !== 1) return { ok: false, error: '线圈值只能是 0 或 1' }
    } else if (n < 0 || n > 65535) {
      return { ok: false, error: '寄存器值必须在 0–65535' }
    }
    values.push(n)
  }
  return {
    ok: true,
    kind: target.kind,
    fc: values.length === 1 ? target.single : target.multi,
    values,
  }
}

/** @param {any} raw */
export const normalizeValueRec = (raw) => {
  const input = raw && typeof raw === 'object' ? raw : {}
  const at = Number(input?.at)
  const rawVal = input && Object.prototype.hasOwnProperty.call(input, 'raw') ? input.raw : null
  const scaled = input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : null
  return {
    key: text(input && (input.key || input.pointId), ''),
    raw: rawVal,
    value: scaled,
    ok: input && input.ok === true,
    error: text(input?.error, '').slice(0, 180),
    at: Number.isFinite(at) && at > 0 ? at : 0,
  }
}

/**
 * @param {any[]} values
 * @param {any} rec
 */
const putValueRec = (values, rec) => {
  const idx = values.findIndex((item) => item.key === rec.key)
  if (idx >= 0) values[idx] = rec
  else values.push(rec)
}

/**
 * @param {any[]} values
 * @param {any} point
 * @param {any} raw
 * @param {any} [opts]
 */
export const setPointValue = (values, point, raw, opts = {}) => {
  const list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const hasRaw = raw !== null && raw !== undefined
  putValueRec(
    list,
    normalizeValueRec({
      key: point.id,
      raw: hasRaw ? raw : null,
      value: hasRaw ? decodeValue(point, typeof raw === 'boolean' ? (raw ? 1 : 0) : raw) : null,
      ok: opts.ok !== false,
      error: opts.error || '',
      at: opts.at || Date.now(),
    }),
  )
  return list.slice(-MAX_VALUES)
}

/**
 * @param {any[]} values
 * @param {any[]} points
 * @param {any} batch
 * @param {any[]} raw
 * @param {boolean} ok
 * @param {string} error
 * @param {number} [at]
 */
export const scatterBatch = (values, points, batch, raw, ok, error, at = Date.now()) => {
  const list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const normalized = normalizePoints(points)
  const batchFc = batch ? (batch.fc !== undefined ? batch.fc : batch.function) : undefined
  for (let i = 0; i < normalized.length; i++) {
    const p = normalized[i]
    if (p.function !== batchFc) continue
    if (p.address < batch.address || p.address >= batch.address + batch.count) continue
    const idx = p.address - batch.address
    const has = ok && Array.isArray(raw) && raw[idx] !== undefined
    putValueRec(
      list,
      normalizeValueRec({
        key: p.id,
        raw: has ? raw[idx] : null,
        value: has ? decodeValue(p, typeof raw[idx] === 'boolean' ? (raw[idx] ? 1 : 0) : raw[idx]) : null,
        ok: !!ok,
        error: ok ? '' : String(error || ''),
        at,
      }),
    )
  }
  return list.slice(-MAX_VALUES)
}

/**
 * @param {any[]} values
 * @param {any[]} points
 * @param {number} [at]
 */
export const fillSimValues = (values, points, at = Date.now()) => {
  let list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const tick = Math.floor(at / 1000)
  for (const p of normalizePoints(points)) {
    let raw
    if (p.function === 1 || p.function === 2) raw = (p.address + tick) % 2 === 0 ? 1 : 0
    else raw = (p.address * 10 + tick) & 0xffff
    list = setPointValue(list, p, raw, { ok: true, at })
  }
  return list
}

/**
 * @param {any} point
 * @param {any} engineeringValue
 */
export const encodeValue = (point, engineeringValue) => {
  const scale = Number(point?.scale)
  if (!Number.isFinite(scale) || scale === 0) return { ok: false, error: 'scale 不能为 0' }
  const offset = Number(point?.offset) || 0
  const n = Number(engineeringValue)
  if (!Number.isFinite(n)) return { ok: false, error: '请输入数值' }
  const raw = (n - offset) / scale
  const rounded = Math.round(raw)
  if (Math.abs(raw - rounded) > 1e-9) return { ok: false, error: `工程值与倍率换算后不是整数寄存器值: ${raw}` }
  if (rounded < 0 || rounded > 65535) return { ok: false, error: `超出寄存器范围 0–65535: ${rounded}` }
  return { ok: true, raw: rounded }
}

/**
 * @param {any} point
 * @param {any} valueRec
 * @param {any} alarmState
 * @param {any} connectionState
 */
export const pointRuntimeStatus = (point, valueRec, alarmState, connectionState) => {
  const alarm = alarmState && typeof alarmState === 'object' ? alarmState[point?.id] : null
  if (alarm && (alarm.condition === 'active' || alarm.status === 'active' || alarm.status === 'unacked')) {
    return { key: 'alarm', label: alarm.kind === 'max' ? '告警·高' : alarm.kind === 'min' ? '告警·低' : '告警' }
  }
  if (valueRec && valueRec.ok === false) return { key: 'comm-error', label: '通信异常' }
  const cs = connectionState || ''
  if (cs === 'disconnected' || cs === 'error' || cs === 'disconnecting')
    return { key: 'disconnected', label: cs === 'error' ? '连接异常' : '已断开' }
  if (valueRec && valueRec.ok === true && valueRec.value !== null && valueRec.value !== undefined)
    return { key: 'ok', label: '正常' }
  return { key: 'unread', label: '未读取' }
}

/**
 * @param {any} [input]
 */
export const normalizePointV3 = (input) => {
  const raw = input && typeof input === 'object' ? input : {}
  const id = devText(raw.id, '') || genId('p')
  const connectionId = devText(raw.connectionId, '') || devText(raw.connId, '') || 'c1'
  const deviceId = devText(raw.deviceId, '') || 'd1'
  const fnRaw = Number(raw.function ?? raw.fn)
  let fn = 3
  let area = devText(raw.area, '')
  if ([1, 2, 3, 4].includes(fnRaw)) {
    fn = fnRaw
    area = AREA_BY_FN[fn]
  } else if (VALID_AREAS.has(area)) {
    fn = FN_BY_AREA[area] || 3
  } else {
    area = 'holdingRegister'
    fn = 3
  }
  const address = devClampInt(raw.address, 0, 0, 65535)
  const scale = Number(raw.scale)
  const offset = Number(raw.offset)
  const name = devText(raw.name, '').slice(0, 40)
  const unit = devText(raw.unit, '').slice(0, 12)
  return {
    id,
    connectionId,
    deviceId,
    name,
    area,
    function: fn,
    address,
    scale: Number.isFinite(scale) ? scale : 1,
    offset: Number.isFinite(offset) ? offset : 0,
    unit,
    alarmMin: finiteOrNull(raw.alarmMin),
    alarmMax: finiteOrNull(raw.alarmMax),
    monitorEnabled: raw.monitorEnabled !== undefined ? raw.monitorEnabled === true : raw.trendEnabled === true,
    alarmEnabled:
      raw.alarmEnabled !== undefined ? raw.alarmEnabled === true : raw.alarmMin != null || raw.alarmMax != null,
    trendEnabled: raw.monitorEnabled !== undefined ? raw.monitorEnabled === true : raw.trendEnabled === true,
  }
}

/**
 * @param {any} list
 * @param {any[]} [connections]
 * @param {any[]} [devices]
 */
export const normalizePointsV3 = (list, connections, devices) => {
  if (!Array.isArray(list)) return []
  const validConnIds = new Set((connections || []).map((c) => c.id))
  const validDevIds = new Set((devices || []).map((d) => d.id))
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const p = normalizePointV3(raw)
    // fix refs
    if (!validConnIds.has(p.connectionId)) p.connectionId = connections?.[0] ? connections[0].id : 'c1'
    if (!validDevIds.has(p.deviceId)) p.deviceId = devices?.[0] ? devices[0].id : 'd1'
    if (seen.has(p.id)) continue
    seen.add(p.id)
    out.push(p)
    if (out.length >= 256) break
  }
  return out
}

/**
 * @param {any} list
 * @param {Set<string>} validKeys
 */
export const filterValues = (list, validKeys) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const rec = normalizeValueRec(raw)
    if (!rec.key || !validKeys.has(rec.key) || seen.has(rec.key)) continue
    seen.add(rec.key)
    out.push(rec)
    if (out.length >= MAX_VALUES_SAFE) break
  }
  return out
}

/**
 * @param {any} list
 * @param {any[]} points
 */
export const normalizeQualifiedValues = (list, points) => {
  if (!Array.isArray(list)) return []
  const byPoint = new Map()
  for (const p of points || []) byPoint.set(p.id, p)
  const seen = new Set()
  const out = []
  for (const raw of list) {
    if (!raw || typeof raw !== 'object') continue
    const pointId = devText(raw.pointId || raw.key || raw.id, '')
    if (!pointId || !byPoint.has(pointId) || seen.has(pointId)) continue
    const pt = byPoint.get(pointId)
    const rec = normalizeValueRec({ ...raw, key: pointId })
    const enriched = {
      ...rec,
      pointId,
      key: pointId,
      connectionId: devText(raw.connectionId, '') || pt.connectionId,
      deviceId: devText(raw.deviceId, '') || pt.deviceId,
    }
    seen.add(pointId)
    out.push(enriched)
    if (out.length >= MAX_VALUES_SAFE) break
  }
  return out
}
