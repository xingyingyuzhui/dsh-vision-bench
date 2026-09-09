// @ts-check
import { decodeValue } from './point-math.mjs'

const pointLabel = (/** @type {any} */ point) => (point ? (point.name ? `${point.name} (${point.id})` : point.id) : '')

/**
 * @param {any} point
 * @param {any} value
 * @returns {string}
 */
export const evaluateAlarm = (point, value) => {
  const p = point || {}
  // TaskP0/0.20.0: 告警开关独立于上下限；仅 alarmEnabled === true 时判越限
  if (p.alarmEnabled !== true) return ''
  if (p.alarmMin === null && p.alarmMax === null) return ''
  // 入参为工程值（调用方先 decodeValue）；阈值比较统一使用工程值
  const n = typeof value === 'number' ? value : Number(value)
  if (!Number.isFinite(n)) return ''
  if (p.alarmMax !== null && n > p.alarmMax) return 'max'
  if (p.alarmMin !== null && n < p.alarmMin) return 'min'
  return ''
}

/**
 * Transition detection over the persisted alarmActive map (keyed by point id).
 * @param {any} points
 * @param {any} values
 * @param {any} active
 */
export const evaluatePointAlarms = (points, values, active) => {
  /** @type {Record<string, any>} */
  const byId = {}
  const list = Array.isArray(points) ? points : []
  for (const p of list) if (p?.id) byId[p.id] = p
  const state = active && typeof active === 'object' ? active : {}
  /** @type {Record<string, any>} */
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

/**
 * @param {any} item
 * @param {string} kind
 */
export const alarmLabelText = (item, kind) => {
  const limit = kind === 'max' ? item.point.alarmMax : item.point.alarmMin
  const shown = decodeValue(item.point, item.raw)
  return `${pointLabel(item.point)}=${shown}${kind === 'max' ? `>${limit}` : `<${limit}`}`
}
