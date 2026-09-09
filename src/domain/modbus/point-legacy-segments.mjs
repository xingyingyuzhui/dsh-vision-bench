// @ts-check
import { decodeValue } from './point-math.mjs'
import { clampInt, functionTag, text } from './point-model.mjs'

export const MAX_SEGMENTS = 256
export const MAX_COUNT = 125
const MAX_VALUES = 512

export const newSegmentId = () => `s${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`

/** @param {any} segment */
export const defaultSegmentName = (segment) => {
  const tag = functionTag(segment.function)
  const last = segment.address + segment.count - 1
  return segment.count === 1 ? `${tag}${segment.address}` : `${tag}${segment.address}–${last}`
}

/**
 * @param {any} segment
 * @param {number} index
 */
export const pointName = (segment, index) => {
  const addr = segment.address + index
  const prefix = text(segment?.name, '')
  if (prefix) return segment.count === 1 ? prefix : `${prefix}[${addr}]`
  return functionTag(segment.function) + addr
}

/**
 * @param {any} segmentId
 * @param {any} address
 * @param {any} fn
 */
export const pointKey = (segmentId, address, fn) => `${segmentId || ''}:${fn}@${address}`

/** @param {any} input */
export const normalizeSegment = (input) => {
  const address = clampInt(input?.address, 0, 0, 65535)
  const fn = new Set([1, 2, 3, 4]).has(Number(input?.function)) ? Number(input.function) : 3
  const maxCount = Math.min(MAX_COUNT, 65536 - address)
  const count = clampInt(input?.count, 1, 1, maxCount || 1)
  const scale = Number(input?.scale)
  const offset = Number(input?.offset)
  const finiteOrNullLocal = (/** @type {any} */ v) =>
    v === null || v === undefined || v === '' ? null : Number.isFinite(Number(v)) ? Number(v) : null
  return {
    id: text(input?.id, newSegmentId()),
    name: text(input?.name, '').slice(0, 40),
    function: fn,
    address,
    count,
    scale: Number.isFinite(scale) ? scale : 1,
    offset: Number.isFinite(offset) ? offset : 0,
    unit: text(input?.unit, '').slice(0, 12),
    alarmMin: finiteOrNullLocal(input?.alarmMin),
    alarmMax: finiteOrNullLocal(input?.alarmMax),
  }
}

/** @param {any} list */
export const normalizeSegments = (list) => {
  if (!Array.isArray(list)) return []
  return list.map(normalizeSegment).slice(0, MAX_SEGMENTS)
}

/** @param {any} input */
export const normalizeValue = (input) => {
  const at = Number(input?.at)
  return {
    key: text(input?.key, ''),
    segmentId: text(input?.segmentId, ''),
    function: new Set([1, 2, 3, 4]).has(Number(input?.function)) ? Number(input.function) : 3,
    address: clampInt(input?.address, 0, 0, 65535),
    name: text(input?.name, '').slice(0, 48),
    value: input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : null,
    ok: input && input.ok === true,
    error: text(input?.error, '').slice(0, 180),
    at: Number.isFinite(at) && at > 0 ? at : 0,
  }
}

/** @param {any} list */
export const normalizeValues = (list) => {
  if (!Array.isArray(list)) return []
  return list
    .map(normalizeValue)
    .filter((item) => item.key)
    .slice(0, MAX_VALUES)
}

/**
 * @param {any} a
 * @param {any} b
 */
export const sameRange = (a, b) => a.function === b.function && a.address === b.address && a.count === b.count

/**
 * @param {any} list
 * @param {any} spec
 */
export const addSegment = (list, spec) => {
  const current = normalizeSegments(list)
  if (current.length >= MAX_SEGMENTS) {
    return { ok: false, error: '地址段数量已达上限', segments: current }
  }
  const address = clampInt(spec?.address, 0, 0, 65535)
  const count = clampInt(spec?.count, 1, 1, MAX_COUNT)
  if (address + count - 1 > 65535) {
    return { ok: false, error: '起始地址加数量超出 65535', segments: current }
  }
  const next = normalizeSegment({
    name: spec?.name,
    function: spec?.function,
    address,
    count,
  })
  if (current.some((item) => sameRange(item, next))) {
    return { ok: false, error: '已有相同功能码和地址范围的段', segments: current }
  }
  return { ok: true, segment: next, segments: current.concat([next]) }
}

/**
 * @param {any} list
 * @param {any} values
 * @param {string} id
 */
export const removeSegment = (list, values, id) => {
  const segments = normalizeSegments(list).filter((item) => item.id !== id)
  const kept = normalizeValues(values).filter((item) => item.segmentId !== id)
  return { segments, values: kept }
}

/** @param {any} segments */
export const expandPoints = (segments) => {
  const out = []
  for (const segment of normalizeSegments(segments)) {
    for (let i = 0; i < segment.count; i++) {
      const address = segment.address + i
      out.push({
        key: pointKey(segment.id, address, segment.function),
        segmentId: segment.id,
        function: segment.function,
        address,
        index: i,
        name: pointName(segment, i),
        range: defaultSegmentName(segment),
        scale: segment.scale,
        offset: segment.offset,
        unit: segment.unit,
      })
      if (out.length >= MAX_VALUES) return out
    }
  }
  return out
}

/**
 * @param {any} values
 * @param {any} segment
 * @param {any} ran
 */
export const applySegmentRead = (values, segment, ran) => {
  /** @type {Record<string, any>} */
  const byKey = {}
  for (const item of normalizeValues(values)) byKey[item.key] = item
  const raw =
    ran?.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw) ? ran.result.details.raw : []
  const at = Date.now()
  const ok = !!ran?.ok
  const error = ok ? '' : String(ran?.error || '')
  const seg = normalizeSegment(segment)
  for (let i = 0; i < seg.count; i++) {
    const address = seg.address + i
    const key = pointKey(seg.id, address, seg.function)
    byKey[key] = normalizeValue({
      key,
      segmentId: seg.id,
      function: seg.function,
      address,
      name: pointName(seg, i),
      value: ok && raw[i] !== undefined ? raw[i] : null,
      ok,
      error,
      at,
    })
  }
  return Object.keys(byKey)
    .map((key) => byKey[key])
    .slice(0, MAX_VALUES)
}

/**
 * @param {any} segments
 * @param {any} fn
 * @param {number} address
 */
export const segmentCovering = (segments, fn, address) =>
  normalizeSegments(segments).find(
    (segment) =>
      segment.function === Number(fn) && address >= segment.address && address < segment.address + segment.count,
  ) || null

/**
 * @param {any} values
 * @param {any} segment
 * @param {number} address
 * @param {any} value
 * @param {number} [at]
 */
export const applyPointWrite = (values, segment, address, value, at = Date.now()) => {
  const seg = normalizeSegment(segment)
  const key = pointKey(seg.id, address, seg.function)
  /** @type {Record<string, any>} */
  const byKey = {}
  for (const item of normalizeValues(values)) byKey[item.key] = item
  byKey[key] = normalizeValue({
    key,
    segmentId: seg.id,
    function: seg.function,
    address,
    name: pointName(seg, address - seg.address),
    value,
    ok: true,
    error: '',
    at,
  })
  return Object.keys(byKey)
    .map((k) => byKey[k])
    .slice(0, MAX_VALUES)
}

/** @param {any} segments */
export const compactSegments = (segments) =>
  normalizeSegments(segments).map((item) => ({
    id: item.id,
    name: item.name || defaultSegmentName(item),
    function: item.function,
    address: item.address,
    count: item.count,
    scale: item.scale,
    offset: item.offset,
    unit: item.unit,
    alarmMin: item.alarmMin,
    alarmMax: item.alarmMax,
  }))

/**
 * @param {any} values
 * @param {any} segments
 */
export const compactValues = (values, segments) => {
  /** @type {Record<string, any>} */
  const byId = {}
  for (const seg of normalizeSegments(segments)) byId[seg.id] = seg
  return normalizeValues(values)
    .slice(0, 32)
    .map((item) => {
      const seg = byId[item.segmentId]
      return {
        name: item.name,
        function: item.function,
        address: item.address,
        value: seg ? decodeValue(seg, item.value) : item.value,
        raw: item.value,
        ok: item.ok,
        unit: seg ? seg.unit : '',
      }
    })
}

/**
 * @param {any} segment
 * @param {number} [at]
 */
export const simulateRaw = (segment, at = Date.now()) => {
  const tick = Math.floor(Number(at) / 1000)
  const raw = []
  const count = Number(segment?.count) || 0
  const address = Number(segment?.address) || 0
  const fn = Number(segment?.function)
  for (let i = 0; i < count; i++) {
    const addr = address + i
    if (fn === 1 || fn === 2) raw.push((addr + tick) % 2 === 0)
    else raw.push((addr * 10 + tick) & 0xffff)
  }
  return raw
}

/**
 * @param {any} segment
 * @param {number} [at]
 */
export const simulateSegmentRan = (segment, at = Date.now()) => ({
  ok: true,
  result: { details: { raw: simulateRaw(segment, at) } },
})

/** @param {any} segments */
export const segmentsToCsv = (segments) =>
  `${[['name', 'function', 'address', 'count', 'scale', 'offset', 'unit', 'alarmMin', 'alarmMax'].join(',')]
    .concat(
      normalizeSegments(segments).map((item) =>
        [
          item.name || defaultSegmentName(item),
          item.function,
          item.address,
          item.count,
          item.scale,
          item.offset,
          item.unit,
          item.alarmMin,
          item.alarmMax,
        ]
          .map((v) => {
            const s = v === null || v === undefined ? '' : String(v)
            return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
          })
          .join(','),
      ),
    )
    .join('\n')}\n`

/** @param {any} input */
export const csvToSegments = (input) => {
  const lines = String(input || '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
  if (!lines.length) return { ok: false, error: 'CSV 为空' }
  const header = lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g, '').toLowerCase())
  /** @type {Record<string, number>} */
  const idx = {}
  for (const key of ['name', 'function', 'address', 'count', 'scale', 'offset', 'unit', 'alarmMin', 'alarmMax']) {
    idx[key] = header.indexOf(key.toLowerCase())
  }
  if (idx.function < 0 || idx.address < 0) {
    return { ok: false, error: 'CSV 缺少 function 或 address 列' }
  }
  const segments = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map((c) => c.trim().replace(/^"|"$/g, ''))
    const pick = (/** @type {string} */ key) => (idx[key] >= 0 ? cells[idx[key]] : '')
    segments.push({
      name: pick('name'),
      function: Number(pick('function')),
      address: Number(pick('address')),
      count: Number(pick('count')) || 1,
      scale: Number(pick('scale')) || 1,
      offset: Number(pick('offset')) || 0,
      unit: pick('unit'),
      alarmMin: pick('alarmMin') === '' ? null : Number(pick('alarmMin')),
      alarmMax: pick('alarmMax') === '' ? null : Number(pick('alarmMax')),
      trendEnabled: pick('trendEnabled') === 'true' || pick('trendEnabled') === '1',
    })
  }
  const normalized = normalizeSegments(segments)
  if (!normalized.length) return { ok: false, error: 'CSV 没有有效段' }
  return { ok: true, segments: normalized }
}
