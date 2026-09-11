function frameDir(frame) {
  const d = String(frame?.direction || 'tx').toLowerCase()
  return d === 'rx' || d === 'in' || d === 'recv' ? 'rx' : 'tx'
}

export function frameMatchesFilters(frame, filters, search) {
  const f = frame || {}
  const flt = filters || {}
  if (flt.deviceId && f.deviceId !== flt.deviceId) return false
  if (flt.functionCode && String(f.functionCode) !== String(flt.functionCode)) return false
  if (flt.status && f.status !== flt.status) return false
  if (flt.source && (f.source || '') !== flt.source) return false
  if (flt.direction && frameDir(f) !== flt.direction) return false
  const needle = String(search || '')
    .trim()
    .toLowerCase()
  if (!needle) return true
  const blob = `${f.request} ${f.response} ${f.hex || ''} ${f.label} ${f.port || ''} ${f.connectionId || ''}`.toLowerCase()
  if (blob.includes(needle)) return true
  const compact = blob.replace(/\s+/g, '')
  const n = needle.replace(/\s+/g, '')
  return Boolean(n) && compact.includes(n)
}

export function filterFrameList(frames, filters, search) {
  if (!Array.isArray(frames)) return []
  return frames.filter((frame) => frameMatchesFilters(frame, filters, search))
}

/** Raw rows have no device/FC/status/source; proto filters must not hide them. */
export function filtersForMode(mode, filters) {
  const flt = filters && typeof filters === 'object' ? filters : {}
  if (mode === 'raw') {
    return { deviceId: '', functionCode: '', status: '', source: '', direction: flt.direction || '' }
  }
  return flt
}
