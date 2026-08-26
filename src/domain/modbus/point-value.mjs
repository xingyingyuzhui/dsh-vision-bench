// @ts-nocheck
import { decodeValue, isWritableFunction } from '../../../bench-points.mjs'

export const STALE_MS = 30 * 1000

export const isStaleValue = (rec) => {
  if (!rec || rec.ok !== true) return false
  const at = Number(rec.at)
  if (!Number.isFinite(at) || at <= 0) return true
  return Date.now() - at > STALE_MS
}

export const compactPointRow = (p, values) => {
  const rec = (Array.isArray(values) ? values : []).find((item) => item.key === p.id || item.pointId === p.id)
  return {
    id: p.id,
    connectionId: p.connectionId,
    connId: p.connectionId,
    deviceId: p.deviceId,
    name: p.name,
    area: p.area,
    function: p.function,
    address: p.address,
    scale: p.scale,
    offset: p.offset,
    unit: p.unit,
    alarmMin: p.alarmMin,
    alarmMax: p.alarmMax,
    monitorEnabled: p.monitorEnabled === true,
    alarmEnabled: p.alarmEnabled === true,
    trendEnabled: p.monitorEnabled === true,
    writable: isWritableFunction(p.function),
    raw: rec ? rec.raw : null,
    value: rec ? (rec.value !== undefined ? rec.value : rec.raw !== null ? decodeValue(p, rec.raw) : null) : null,
    ok: rec ? rec.ok : false,
    at: rec ? rec.at : 0,
  }
}
