export function fileKind(file) {
  if (!file) return 'ok'
  if (!file.inside) return 'outside'
  if (!file.exists) return 'missing'
  if (!file.readable) return 'unread'
  return 'ok'
}

export function filePassesFilter(file, filter) {
  if (filter === 'all' || !filter) return true
  if (filter === 'missing') return !file.exists
  if (filter === 'unread') return !!(file.exists && !file.readable)
  if (filter === 'outside') return !file.inside
  return true
}

export function fileMatchesSearch(file, needle) {
  if (!needle) return true
  const hay = `${file && (file.name || '')} ${file.rel || file.path || ''}`.toLowerCase()
  if (hay.includes(needle)) return true
  const fns = file?.functions || []
  return fns.some((fn) =>
    String(fn?.name || '')
      .toLowerCase()
      .includes(needle),
  )
}
