// @ts-check
// Task3/0.19.3: per-workspace trend ring buffers, sampled at COMMIT time.
//
// Only points with `monitorEnabled === true` produce samples. Read, poll and
// write-readback all flow through bench-modbus-commit's single commit path, so
// sampling never depends on which sidebar page is open. Communication failures
// write a `null` breakpoint (the chart does not connect error gaps).
//
// This module is host-side only (imported via bench-modbus-commit → bench-modbus
// → bench-tool/host); the browser bundle never references it.
import { normalizeModbus } from './modbus-migration.mjs'
import { functionTag } from '../../domain/modbus/point-model.mjs'
import { loadWorkspace, saveWorkspaceAsync } from '../../infrastructure/store/workspace-store.mjs'

export const TREND_KEEP = 600

/**
 * @param {any} [input]
 * @returns {any}
 */
export const normalizeTrendByPoint = (input) => {
  if (!input || typeof input !== 'object') return {}
  const out = /** @type {Record<string, any>} */ ({})
  for (const [pid, list] of Object.entries(input)) {
    if (pid === '__rev') continue
    if (!Array.isArray(list)) continue
    const clean = []
    for (const sample of list) {
      const t = Number(sample && (sample.t ?? sample[0]))
      if (!Number.isFinite(t) || t <= 0) continue
      const v = sample == null ? null : sample.v !== undefined ? sample.v : sample[1]
      clean.push([t, v === null || v === undefined ? null : Number(v)])
    }
    if (clean.length) out[pid] = clean.slice(-TREND_KEEP)
  }
  const rev = Number(input.__rev)
  if (Number.isFinite(rev) && rev > 0) out.__rev = Math.trunc(rev)
  return out
}

// merge new point values into the persisted trend map (pure transform)
/**
 * @param {any} [trendIn]
 * @param {any} [pointValues]
 * @param {any} [pointsById]
 * @returns {any}
 */
export const sampleTrendValues = (trendIn, pointValues, pointsById) => {
  const trend = { ...(trendIn || {}) }
  const now = Date.now()
  let touched = false
  for (const rec of Array.isArray(pointValues) ? pointValues : []) {
    const pid = rec && (rec.pointId || rec.key)
    if (!pid) continue
    const pt = pointsById && pointsById[pid]
    if (!pt || pt.monitorEnabled !== true) continue
    let list = Array.isArray(trend[pid]) ? trend[pid].slice() : []
    // 通信失败 → null 断点；成功 → 数值（回退 raw）
    const ok = rec.ok !== false
    let val = null
    if (ok) {
      const n = Number(rec.value)
      val = Number.isFinite(n) ? n : Number.isFinite(Number(rec.raw)) ? Number(rec.raw) : null
    }
    const last = list[list.length - 1]
    if (!ok || val == null) {
      if (last && last[1] != null) {
        list.push([last[0] + 1, null])
        if (list.length > TREND_KEEP) list = list.slice(list.length - TREND_KEEP)
        trend[pid] = list
        touched = true
      }
      continue
    }
    list.push([Number(rec.at) || now, val])
    if (list.length > TREND_KEEP) list = list.slice(list.length - TREND_KEEP)
    trend[pid] = list
    touched = true
  }
  if (touched) trend.__rev = (Number(trendIn?.__rev) || 0) + 1
  else if (trend.__rev == null && trendIn?.__rev != null) trend.__rev = Number(trendIn.__rev) || 0
  return trend
}

/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [opts]
 * @returns {any}
 */
export const readTrendSeries = (home, cwd, opts = {}) => {
  const pack = normalizeModbus(loadWorkspace(home, cwd).modbus || {})
  const trend = pack.trend || {}
  const ids =
    Array.isArray(opts.pointIds) && opts.pointIds.length
      ? opts.pointIds
      : pack.points
          .filter((/** @type {any} */ p) => p.monitorEnabled === true)
          .slice(0, 8)
          .map((/** @type {any} */ p) => p.id)
  const from = Number(opts.start) || 0
  const to = Number(opts.end) || Date.now()
  return ids.map((/** @type {any} */ pid) => {
    const pt = pack.points.find((/** @type {any} */ p) => p.id === pid)
    const list = Array.isArray(trend[pid]) ? trend[pid] : []
    return {
      pointId: pid,
      name: pt ? pt.name || functionTag(pt.function) + pt.address : pid,
      connectionId: pt ? pt.connectionId : '',
      deviceId: pt ? pt.deviceId : '',
      unit: pt ? pt.unit : '',
      count: list.length,
      samples: list.filter((/** @type {any} */ sv) => (!from || sv[0] >= from) && (!to || sv[0] <= to)).slice(-TREND_KEEP),
    }
  })
}

/**
 * @param {any} [home]
 * @param {any} [cwd]
 * @param {any} [pointIds]
 * @returns {Promise<any>}
 */
export const clearTrendByPoint = async (home, cwd, pointIds) => {
  const pack = normalizeModbus(loadWorkspace(home, cwd).modbus || {})
  const trend = { ...(pack.trend || {}) }
  for (const pid of Array.isArray(pointIds) ? pointIds : []) delete trend[pid]
  await saveWorkspaceAsync(home, cwd, { modbus: { trend, version: 3 } })
  return { ok: true }
}
