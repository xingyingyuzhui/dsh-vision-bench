// @ts-check
/**
 * Safe runtime-value selection for points get/list.
 * Identity first (layered workspace), then match values — never use backfilled
 * conn/dev fields to resolve multi-owner ambiguity.
 */
import { compactPointRow } from '../../domain/modbus/point-value.mjs'
import { resolveEffectivePointIdentity } from './poll-runtime-identity.mjs'

/**
 * @param {any} point
 * @returns {{ connectionId: string, deviceId: string, pointId: string }}
 */
function pointTriple(point) {
  return {
    pointId: String(point?.id || ''),
    connectionId: String(point?.connectionId || point?.connId || ''),
    deviceId: String(point?.deviceId || ''),
  }
}

/**
 * @param {any} rec
 * @returns {{ connectionId: string, deviceId: string, pointId: string }}
 */
function recordTriple(rec) {
  return {
    pointId: String(rec?.pointId || rec?.key || rec?.id || ''),
    connectionId: String(rec?.connectionId || rec?.connId || ''),
    deviceId: String(rec?.deviceId || ''),
  }
}

/**
 * @param {any[]} values
 * @param {string} pointId
 * @returns {any[]}
 */
function recordsForPointId(values, pointId) {
  if (!pointId || !Array.isArray(values)) return []
  return values.filter((rec) => {
    if (!rec || typeof rec !== 'object') return false
    const id = String(rec.pointId || rec.key || rec.id || '')
    return id === pointId
  })
}

/**
 * Compare record provenance to a visible point.
 * Empty record conn/dev are allowed ONLY when identity is already unique
 * (legacy backfill compatibility) — caller must not invoke this under ambiguity.
 *
 * @param {any} rec
 * @param {{ connectionId: string, deviceId: string, pointId: string }} point
 * @param {boolean} allowEmptyProvenance
 */
function recordMatchesPoint(rec, point, allowEmptyProvenance) {
  const r = recordTriple(rec)
  if (r.pointId !== point.pointId) return false
  const connOk = r.connectionId === point.connectionId || (allowEmptyProvenance && !r.connectionId)
  const devOk = r.deviceId === point.deviceId || (allowEmptyProvenance && !r.deviceId)
  return connOk && devOk
}

/**
 * @param {{
 *   workspaceModbus: any,
 *   point: any,
 *   values: any,
 * }} input
 * @returns {{
 *   status: 'available' | 'missing' | 'unavailable',
 *   record: any | null,
 *   reason?: string,
 * }}
 */
export function selectPointQueryValue(input) {
  const point = input?.point
  const values = input?.values
  const workspaceModbus = input?.workspaceModbus
  const triple = pointTriple(point)
  if (!triple.pointId) {
    return { status: 'missing', record: null, reason: 'no-point-id' }
  }

  const identity = resolveEffectivePointIdentity(workspaceModbus, triple.pointId)
  const candidates = recordsForPointId(values, triple.pointId)
  const hasRecord = candidates.length > 0

  if (identity.kind === 'ambiguous') {
    return {
      status: hasRecord ? 'unavailable' : 'missing',
      record: null,
      reason: 'ambiguous',
    }
  }

  if (identity.kind === 'missing') {
    return {
      status: hasRecord ? 'unavailable' : 'missing',
      record: null,
      reason: 'identity-missing',
    }
  }

  const sole = identity.identities[0]
  if (
    !sole ||
    sole.connectionId !== triple.connectionId ||
    sole.deviceId !== triple.deviceId ||
    sole.pointId !== triple.pointId
  ) {
    return {
      status: hasRecord ? 'unavailable' : 'missing',
      record: null,
      reason: 'visible-mismatch',
    }
  }

  if (!hasRecord) {
    return { status: 'missing', record: null, reason: 'no-record' }
  }

  /** Distinct non-empty provenance among candidates. */
  const provenances = new Set()
  for (const rec of candidates) {
    const r = recordTriple(rec)
    if (r.connectionId || r.deviceId) {
      provenances.add(`${r.connectionId}\0${r.deviceId}`)
    }
  }
  if (provenances.size > 1) {
    return { status: 'unavailable', record: null, reason: 'multi-provenance' }
  }

  const matched = candidates.filter((rec) => recordMatchesPoint(rec, triple, true))
  if (!matched.length) {
    return { status: 'unavailable', record: null, reason: 'mismatch' }
  }

  return { status: 'available', record: matched[0], reason: 'matched' }
}

/**
 * Build a compact point row with mandatory valueStatus for get/list.
 * Caller is responsible for identity checks via selectPointQueryValue.
 *
 * @param {any} point
 * @param {{ workspaceModbus: any, values: any }} ctx
 */
export function compactPointRowForQuery(point, ctx) {
  const selected = selectPointQueryValue({
    workspaceModbus: ctx.workspaceModbus,
    point,
    values: ctx.values,
  })
  const row = compactPointRow(point, selected.record ? [selected.record] : [])
  row.valueStatus = selected.status
  if (selected.status !== 'available') {
    row.raw = null
    row.value = null
    row.ok = false
    row.at = 0
  }
  return row
}
