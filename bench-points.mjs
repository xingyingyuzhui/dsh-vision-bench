export const MAX_SEGMENTS = 24
export const MAX_COUNT = 125
export const MAX_VALUES = 512
const FUNCTIONS = new Set([1, 2, 3, 4])

const FN_TAG = { 1: 'C', 2: 'DI', 3: 'HR', 4: 'IR' }

export const functionTag = (fn) => FN_TAG[fn] || 'HR'

export const text = (value, fallback) => {
  const out = typeof value === 'string' ? value.trim() : ''
  return out || fallback || ''
}

export const clampInt = (value, fallback, min, max) => {
  const n = Number(value)
  if (!Number.isFinite(n)) return fallback
  const i = Math.trunc(n)
  if (i < min) return min
  if (i > max) return max
  return i
}

export const newSegmentId = () =>
  's' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)

export const defaultSegmentName = (segment) => {
  const tag = functionTag(segment.function)
  const last = segment.address + segment.count - 1
  return segment.count === 1 ? tag + segment.address : tag + segment.address + '–' + last
}

export const pointName = (segment, index) => {
  const addr = segment.address + index
  const prefix = text(segment && segment.name, '')
  if (prefix) return segment.count === 1 ? prefix : prefix + '[' + addr + ']'
  return functionTag(segment.function) + addr
}

export const pointKey = (segmentId, address, fn) =>
  String(segmentId || '') + ':' + String(fn) + '@' + String(address)

export const normalizeSegment = (input) => {
  const address = clampInt(input && input.address, 0, 0, 65535)
  const maxCount = Math.min(MAX_COUNT, 65536 - address)
  const count = clampInt(input && input.count, 1, 1, maxCount || 1)
  const fn = FUNCTIONS.has(Number(input && input.function)) ? Number(input.function) : 3
  return {
    id: text(input && input.id, newSegmentId()),
    name: text(input && input.name, '').slice(0, 40),
    function: fn,
    address,
    count,
  }
}

export const normalizeSegments = (list) => {
  if (!Array.isArray(list)) return []
  return list.map(normalizeSegment).slice(0, MAX_SEGMENTS)
}

export const normalizeValue = (input) => {
  const at = Number(input && input.at)
  return {
    key: text(input && input.key, ''),
    segmentId: text(input && input.segmentId, ''),
    function: FUNCTIONS.has(Number(input && input.function)) ? Number(input.function) : 3,
    address: clampInt(input && input.address, 0, 0, 65535),
    name: text(input && input.name, '').slice(0, 48),
    value: input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : null,
    ok: input && input.ok === true,
    error: text(input && input.error, '').slice(0, 180),
    at: Number.isFinite(at) && at > 0 ? at : 0,
  }
}

export const normalizeValues = (list) => {
  if (!Array.isArray(list)) return []
  return list.map(normalizeValue).filter((item) => item.key).slice(0, MAX_VALUES)
}

export const sameRange = (a, b) =>
  a.function === b.function && a.address === b.address && a.count === b.count

export const addSegment = (list, spec) => {
  const current = normalizeSegments(list)
  if (current.length >= MAX_SEGMENTS) {
    return { ok: false, error: '地址段数量已达上限', segments: current }
  }
  const address = clampInt(spec && spec.address, 0, 0, 65535)
  const count = clampInt(spec && spec.count, 1, 1, MAX_COUNT)
  if (address + count - 1 > 65535) {
    return { ok: false, error: '起始地址加数量超出 65535', segments: current }
  }
  const next = normalizeSegment({
    name: spec && spec.name,
    function: spec && spec.function,
    address,
    count,
  })
  if (current.some((item) => sameRange(item, next))) {
    return { ok: false, error: '已有相同功能码和地址范围的段', segments: current }
  }
  return { ok: true, segment: next, segments: current.concat([next]) }
}

export const removeSegment = (list, values, id) => {
  const segments = normalizeSegments(list).filter((item) => item.id !== id)
  const kept = normalizeValues(values).filter((item) => item.segmentId !== id)
  return { segments, values: kept }
}

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
      })
      if (out.length >= MAX_VALUES) return out
    }
  }
  return out
}

export const applySegmentRead = (values, segment, ran) => {
  const byKey = {}
  for (const item of normalizeValues(values)) byKey[item.key] = item
  const raw = ran && ran.ok && ran.result && ran.result.details && Array.isArray(ran.result.details.raw)
    ? ran.result.details.raw
    : []
  const at = Date.now()
  const ok = !!(ran && ran.ok)
  const error = ok ? '' : String((ran && ran.error) || '')
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
  return Object.keys(byKey).map((key) => byKey[key]).slice(0, MAX_VALUES)
}

export const compactSegments = (segments) =>
  normalizeSegments(segments).map((item) => ({
    id: item.id,
    name: item.name || defaultSegmentName(item),
    function: item.function,
    address: item.address,
    count: item.count,
  }))

export const compactValues = (values) =>
  normalizeValues(values).slice(0, 32).map((item) => ({
    name: item.name,
    function: item.function,
    address: item.address,
    value: item.value,
    ok: item.ok,
  }))

export const simulateRaw = (segment, at = Date.now()) => {
  const tick = Math.floor(Number(at) / 1000)
  const raw = []
  const count = Number(segment && segment.count) || 0
  const address = Number(segment && segment.address) || 0
  const fn = Number(segment && segment.function)
  for (let i = 0; i < count; i++) {
    const addr = address + i
    if (fn === 1 || fn === 2) raw.push((addr + tick) % 2 === 0)
    else raw.push((addr * 10 + tick) & 0xffff)
  }
  return raw
}

export const simulateSegmentRan = (segment, at) => ({
  ok: true,
  result: { details: { raw: simulateRaw(segment, at) } },
})
