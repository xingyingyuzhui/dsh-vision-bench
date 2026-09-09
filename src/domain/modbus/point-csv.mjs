// @ts-check
import { functionTag, normalizePoints } from './point-model.mjs'

const CSV_HEADER = [
  'name',
  'function',
  'address',
  'scale',
  'offset',
  'unit',
  'monitorEnabled',
  'alarmEnabled',
  'alarmMin',
  'alarmMax',
]

/** @param {any} value */
const csvCell = (value) => {
  const s = value === null || value === undefined ? '' : String(value)
  return /[",\n\r]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s
}

/** @param {string} line */
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

/** @param {any} points */
export const pointsToCsv = (points) =>
  `${[CSV_HEADER.join(',')]
    .concat(
      normalizePoints(points).map((item) =>
        [
          item.name || functionTag(item.function) + item.address,
          item.function,
          item.address,
          item.scale,
          item.offset,
          item.unit,
          item.monitorEnabled === true ? 'true' : '',
          item.alarmEnabled === true ? 'true' : '',
          item.alarmMin,
          item.alarmMax,
        ]
          .map(csvCell)
          .join(','),
      ),
    )
    .join('\n')}\n`

/** @param {any} input */
export const csvToPoints = (input) => {
  const lines = String(input || '')
    .split(/\r?\n/)
    .filter((line) => line.trim())
  if (!lines.length) return { ok: false, error: 'CSV 为空' }
  const header = csvSplit(lines[0]).map((cell) => cell.trim().toLowerCase())
  /** @type {Record<string, number>} */
  const idx = {}
  for (const key of CSV_HEADER) {
    idx[key] = header.indexOf(key.toLowerCase())
  }
  // TaskP0/0.20.0: 旧 trendEnabled 列作为 monitorEnabled 兼容别名
  if (idx.monitorEnabled < 0) idx.monitorEnabled = header.indexOf('trendenabled')
  if (idx.trendEnabled < 0) idx.trendEnabled = header.indexOf('trendenabled')
  if (idx.function < 0 || idx.address < 0) {
    return { ok: false, error: 'CSV 缺少 function 或 address 列' }
  }
  const points = []
  for (let i = 1; i < lines.length; i++) {
    const cells = csvSplit(lines[i])
    const pick = (/** @type {string} */ key) => (idx[key] >= 0 ? cells[idx[key]] : '')
    if (pick('address') === '') continue
    points.push({
      name: pick('name'),
      function: Number(pick('function')),
      address: Number(pick('address')),
      scale: Number(pick('scale')) || 1,
      offset: Number(pick('offset')) || 0,
      unit: pick('unit'),
      alarmMin: pick('alarmMin') === '' ? null : Number(pick('alarmMin')),
      alarmMax: pick('alarmMax') === '' ? null : Number(pick('alarmMax')),
      monitorEnabled:
        pick('monitorEnabled') === 'true' ||
        pick('monitorEnabled') === '1' ||
        pick('trendEnabled') === 'true' ||
        pick('trendEnabled') === '1',
      alarmEnabled: pick('alarmEnabled') === 'true' || pick('alarmEnabled') === '1',
    })
  }
  const normalized = normalizePoints(points)
  if (!normalized.length) return { ok: false, error: 'CSV 没有有效点位' }
  return { ok: true, points: normalized }
}
