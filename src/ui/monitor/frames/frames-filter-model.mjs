export function frameMatchesFilters(frame, filters, search) {
  const f = frame || {}
  const flt = filters || {}
  if (flt.deviceId && f.deviceId !== flt.deviceId) return false
  if (flt.functionCode && String(f.functionCode) !== String(flt.functionCode)) return false
  if (flt.status && f.status !== flt.status) return false
  if (flt.source && (f.source || '') !== flt.source) return false
  const needle = String(search || '')
    .trim()
    .toLowerCase()
  if (!needle) return true
  return `${f.request} ${f.response} ${f.label} ${f.connectionId || ''}`.toLowerCase().includes(needle)
}

export function filterFrameList(frames, filters, search) {
  if (!Array.isArray(frames)) return []
  return frames.filter((frame) => frameMatchesFilters(frame, filters, search))
}
