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

export function fileTreeId(file) {
  return String((file && (file.rel || file.path || file.name)) || '')
}

export function buildProjectTree(groups, opts = {}) {
  const filter = opts.filter || 'all'
  const needle = String(opts.search || '')
    .trim()
    .toLowerCase()
  const out = []
  for (const group of Array.isArray(groups) ? groups : []) {
    const files = (group.files || []).filter((file) => filePassesFilter(file, filter))
    const shown = needle ? files.filter((file) => fileMatchesSearch(file, needle)) : files
    if (needle && !shown.length) continue
    out.push({
      id: `group:${String(group.name || '')}`,
      kind: 'group',
      name: group.name || '',
      files: shown,
      total: files.length,
      matched: shown.length,
      outside: (group.files || []).filter((f) => !f.inside).length,
      missing: (group.files || []).filter((f) => !f.exists).length,
    })
  }
  return out
}

export function languageForPath(rel) {
  const name = String(rel || '').toLowerCase()
  if (/\.(json)$/.test(name)) return 'json'
  if (/\.(c|h|cc|cpp|cxx|hpp|hh|inc)$/.test(name)) return 'cpp'
  return 'plain'
}
