// Point-first Modbus model. A point is one fully configured register/coil;
// polling batches are derived (bench-pollplan.mjs), never hand-built.

export const MAX_POINTS = 256
export const MAX_VALUES = 512
const FUNCTIONS = new Set([1, 2, 3, 4])

const FN_TAG = { 1: 'C', 2: 'DI', 3: 'HR', 4: 'IR' }

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

export const clockOf = (ms) => {
  const d = new Date(Number(ms) || Date.now())
  const pad = (n) => String(n).padStart(2, '0')
  return pad(d.getHours()) + ':' + pad(d.getMinutes()) + ':' + pad(d.getSeconds())
}

export const functionTag = (fn) => FN_TAG[fn] || 'HR'

const WRITE_TARGET_OF = {
  1: { single: 5, multi: 15, kind: 'coil', maxMulti: 1968 },
  3: { single: 6, multi: 16, kind: 'register', maxMulti: 123 },
}

export const writeTargetOf = (fn) => {
  const target = WRITE_TARGET_OF[Number(fn)]
  return target ? { writable: true, ...target } : { writable: false, single: 0, multi: 0, kind: '', maxMulti: 0 }
}

export const isWritableFunction = (fn) => !!WRITE_TARGET_OF[Number(fn)]

const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

export const pointIdOf = (fn, address) => 'p' + Number(fn) + '_' + Number(address)

const FALLBACK_NAME_TAG = { 1: '线圈', 2: '离散量', 3: '寄存器', 4: '输入' }

export const normalizePoint = (input) => {
  const fn = FUNCTIONS.has(Number(input && input.function)) ? Number(input.function) : 3
  const address = clampInt(input && input.address, 0, 0, 65535)
  const scale = Number(input && input.scale)
  const offset = Number(input && input.offset)
  const id = text(input && input.id, '') || pointIdOf(fn, address)
  const name = text(input && input.name, '')
  return {
    id,
    name: name.slice(0, 40),
    function: fn,
    address,
    scale: Number.isFinite(scale) ? scale : 1,
    offset: Number.isFinite(offset) ? offset : 0,
    unit: text(input && input.unit, '').slice(0, 12),
    alarmMin: finiteOrNull(input && input.alarmMin),
    alarmMax: finiteOrNull(input && input.alarmMax),
  }
}

export const normalizePoints = (list) => {
  if (!Array.isArray(list)) return []
  const seen = new Set()
  const out = []
  for (const raw of list) {
    const point = normalizePoint(raw)
    if (seen.has(point.id)) continue
    seen.add(point.id)
    out.push(point)
    if (out.length >= MAX_POINTS) break
  }
  return out
}

export const pointLabel = (point) =>
  (point && point.name) || functionTag(point && point.function) + (point ? point.address : '?')

export const findPoint = (points, fn, address) =>
  normalizePoints(points).find((item) => item.function === Number(fn) && item.address === Number(address)) || null

// ── write validation (unchanged semantics) ───────────────────────────────

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
  return { ok: true, kind: target.kind, fc: values.length === 1 ? target.single : target.multi, values }
}

// ── value records keyed by point id ──────────────────────────────────────

export const normalizeValueRec = (input) => {
  const at = Number(input && input.at)
  const raw = input && Object.prototype.hasOwnProperty.call(input, 'raw') ? input.raw : null
  const scaled = input && Object.prototype.hasOwnProperty.call(input, 'value') ? input.value : null
  return {
    key: text(input && input.key, ''),
    raw,
    value: scaled,
    ok: input && input.ok === true,
    error: text(input && input.error, '').slice(0, 180),
    at: Number.isFinite(at) && at > 0 ? at : 0,
  }
}

const putValueRec = (values, rec) => {
  const idx = values.findIndex((item) => item.key === rec.key)
  if (idx >= 0) values[idx] = rec
  else values.push(rec)
}

export const setPointValue = (values, point, raw, opts = {}) => {
  const list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const hasRaw = raw !== null && raw !== undefined
  putValueRec(list, normalizeValueRec({
    key: point.id,
    raw: hasRaw ? raw : null,
    value: hasRaw ? decodeValue(point, typeof raw === 'boolean' ? (raw ? 1 : 0) : raw) : null,
    ok: opts.ok !== false,
    error: opts.error || '',
    at: opts.at || Date.now(),
  }))
  return list.slice(-MAX_VALUES)
}

// Scatter a read batch result onto the points it covers.
export const scatterBatch = (values, points, batch, raw, ok, error, at = Date.now()) => {
  const list = (Array.isArray(values) ? values : []).map(normalizeValueRec).filter((r) => r.key)
  const normalized = normalizePoints(points)
  for (let i = 0; i < normalized.length; i++) {
    const p = normalized[i]
    if (p.function !== batch.fc) continue
    if (p.address < batch.address || p.address >= batch.address + batch.count) continue
    const idx = p.address - batch.address
    const has = ok && Array.isArray(raw) && raw[idx] !== undefined
    putValueRec(list, normalizeValueRec({
      key: p.id,
      raw: has ? raw[idx] : null,
      value: has ? decodeValue(p, typeof raw[idx] === 'boolean' ? (raw[idx] ? 1 : 0) : raw[idx]) : null,
      ok: !!ok,
      error: ok ? '' : String(error || ''),
      at,
    }))
  }
  return list.slice(-MAX_VALUES)
}

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

// ── decode / alarms ──────────────────────────────────────────────────────

export const decodeValue = (point, raw) => {
  if (raw === null || raw === undefined || raw === '') return raw
  if (typeof raw === 'boolean') return raw
  const n = Number(raw)
  if (!Number.isFinite(n)) return raw
  const scale = Number(point && point.scale)
  const offset = Number(point && point.offset)
  return n * (Number.isFinite(scale) ? scale : 1) + (Number.isFinite(offset) ? offset : 0)
}

export const evaluateAlarm = (point, raw) => {
  const p = point || {}
  if (p.alarmMin === null && p.alarmMax === null) return ''
  const n = typeof raw === 'number' ? raw : Number(raw)
  if (!Number.isFinite(n)) return ''
  if (p.alarmMax !== null && n > p.alarmMax) return 'max'
  if (p.alarmMin !== null && n < p.alarmMin) return 'min'
  return ''
}

// Transition detection over the persisted alarmActive map (keyed by point id).
export const evaluatePointAlarms = (points, values, active) => {
  const byId = {}
  for (const p of normalizePoints(points)) byId[p.id] = p
  const state = active && typeof active === 'object' ? active : {}
  const next = { ...state }
  const fired = []
  const cleared = []
  for (const rec of Array.isArray(values) ? values : []) {
    if (!rec || !rec.key || rec.ok !== true) continue
    const p = byId[rec.key]
    if (!p || (p.alarmMin === null && p.alarmMax === null)) continue
    const breach = evaluateAlarm(p, rec.raw)
    if (breach && !next[rec.key]) {
      next[rec.key] = true
      fired.push({ point: p, raw: rec.raw, kind: breach })
    } else if (!breach && next[rec.key]) {
      delete next[rec.key]
      cleared.push({ point: p, raw: rec.raw })
    }
  }
  return { next, fired, cleared }
}

export const alarmLabelText = (item, kind) => {
  const limit = kind === 'max' ? item.point.alarmMax : item.point.alarmMin
  const shown = decodeValue(item.point, item.raw)
  return pointLabel(item.point) + '=' + shown + (kind === 'max' ? '>' + limit : '<' + limit)
}

// ── CSV round-trip (per-point columns) ───────────────────────────────────

const CSV_HEADER = ['name', 'function', 'address', 'scale', 'offset', 'unit', 'alarmMin', 'alarmMax']

const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
}

const csvSplit = (line) => {
  const out = []
  let cur = ''
  let quoted = false
  for (let i = 0; i < line.length; i++) {
    const ch = line[i]
    if (quoted) {
      if (ch === '"') {
        if (line[i + 1] === '"') {
          cur += '"'
          i++
        } else quoted = false
      } else cur += ch
    } else if (ch === '"') {
      quoted = true
    } else if (ch === ',') {
      out.push(cur)
      cur = ''
    } else cur += ch
  }
  out.push(cur)
  return out
}

export const pointsToCsv = (points) =>
  [CSV_HEADER.join(',')]
    .concat(normalizePoints(points).map((item) => [
      item.name || functionTag(item.function) + item.address,
      item.function,
      item.address,
      item.scale,
      item.offset,
      item.unit,
      item.alarmMin,
      item.alarmMax,
    ].map(csvCell).join(',')))
    .join('\n') + '\n'

export const csvToPoints = (input) => {
  const lines = String(input || '').split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return { ok: false, error: 'CSV 为空' }
  const header = csvSplit(lines[0]).map((cell) => cell.trim().toLowerCase())
  const idx = {}
  CSV_HEADER.forEach((key) => { idx[key] = header.indexOf(key.toLowerCase()) })
  if (idx.function < 0 || idx.address < 0) {
    return { ok: false, error: 'CSV 缺少 function 或 address 列' }
  }
  const points = []
  for (let i = 1; i < lines.length; i++) {
    const cells = csvSplit(lines[i])
    const pick = (key) => (idx[key] >= 0 ? cells[idx[key]] : '')
    if (pick('address') === '' ) continue
    points.push({
      name: pick('name'),
      function: Number(pick('function')),
      address: Number(pick('address')),
      scale: Number(pick('scale')) || 1,
      offset: Number(pick('offset')) || 0,
      unit: pick('unit'),
      alarmMin: pick('alarmMin') === '' ? null : Number(pick('alarmMin')),
      alarmMax: pick('alarmMax') === '' ? null : Number(pick('alarmMax')),
    })
  }
  const normalized = normalizePoints(points)
  if (!normalized.length) return { ok: false, error: 'CSV 没有有效点位' }
  return { ok: true, points: normalized }
}


// ── Legacy compatibility shims (pre-v0.18 segment model) ─────────────────
// Kept for bench-slave and old tests until they migrate.

export const MAX_SEGMENTS = 256
export const MAX_COUNT = 125

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
  const fn = new Set([1,2,3,4]).has(Number(input && input.function)) ? Number(input.function) : 3
  const maxCount = Math.min(MAX_COUNT, 65536 - address)
  const count = clampInt(input && input.count, 1, 1, maxCount || 1)
  const scale = Number(input && input.scale)
  const offset = Number(input && input.offset)
  const finiteOrNullLocal = (v) => (v===null||v===undefined||v===''?null:(Number.isFinite(Number(v))?Number(v):null))
  return {
    id: text(input && input.id, newSegmentId()),
    name: text(input && input.name, '').slice(0, 40),
    function: fn,
    address,
    count,
    scale: Number.isFinite(scale) ? scale : 1,
    offset: Number.isFinite(offset) ? offset : 0,
    unit: text(input && input.unit, '').slice(0, 12),
    alarmMin: finiteOrNullLocal(input && input.alarmMin),
    alarmMax: finiteOrNullLocal(input && input.alarmMax),
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
    function: new Set([1,2,3,4]).has(Number(input && input.function)) ? Number(input.function) : 3,
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
        scale: segment.scale,
        offset: segment.offset,
        unit: segment.unit,
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

export const segmentCovering = (segments, fn, address) =>
  normalizeSegments(segments).find((segment) => segment.function === Number(fn)
    && address >= segment.address
    && address < segment.address + segment.count) || null

export const applyPointWrite = (values, segment, address, value, at = Date.now()) => {
  const seg = normalizeSegment(segment)
  const key = pointKey(seg.id, address, seg.function)
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
  return Object.keys(byKey).map((k) => byKey[k]).slice(0, MAX_VALUES)
}

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

export const compactValues = (values, segments) => {
  const byId = {}
  for (const seg of normalizeSegments(segments)) byId[seg.id] = seg
  return normalizeValues(values).slice(0, 32).map((item) => {
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

export const segmentsToCsv = (segments) =>
  [['name','function','address','count','scale','offset','unit','alarmMin','alarmMax'].join(',')]
    .concat(normalizeSegments(segments).map((item) => [
      item.name || defaultSegmentName(item),
      item.function,
      item.address,
      item.count,
      item.scale,
      item.offset,
      item.unit,
      item.alarmMin,
      item.alarmMax,
    ].map((v) => {
      const s = v === null || v === undefined ? '' : String(v)
      return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s
    }).join(',')))
    .join('\n') + '\n'

export const csvToSegments = (input) => {
  const lines = String(input || '').split(/\r?\n/).filter((line) => line.trim())
  if (!lines.length) return { ok: false, error: 'CSV 为空' }
  const header = lines[0].split(',').map((cell) => cell.trim().replace(/^"|"$/g,'').toLowerCase())
  const idx = {}
  ;['name','function','address','count','scale','offset','unit','alarmMin','alarmMax'].forEach((key) => { idx[key] = header.indexOf(key.toLowerCase()) })
  if (idx.function < 0 || idx.address < 0) {
    return { ok: false, error: 'CSV 缺少 function 或 address 列' }
  }
  const segments = []
  for (let i = 1; i < lines.length; i++) {
    const cells = lines[i].split(',').map(c=>c.trim().replace(/^"|"$/g,''))
    const pick = (key) => (idx[key] >= 0 ? cells[idx[key]] : '')
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
    })
  }
  const normalized = normalizeSegments(segments)
  if (!normalized.length) return { ok: false, error: 'CSV 没有有效段' }
  return { ok: true, segments: normalized }
}
