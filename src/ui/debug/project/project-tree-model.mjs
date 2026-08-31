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

function normPath(p) {
  return String(p || '')
    .replace(/\\/g, '/')
    .replace(/^\.\//, '')
}

export function findProjectFile(groups, file) {
  const want = normPath(file)
  if (!want) return null
  const wantBase = want.split('/').filter(Boolean).pop()
  const hits = []
  for (const group of Array.isArray(groups) ? groups : []) {
    for (const item of group.files || []) {
      const rel = normPath(item.rel || item.path || item.name)
      const name = String(item.name || rel.split('/').pop() || '')
      let score = 0
      if (rel === want) score = 4
      else if (rel.endsWith(`/${want}`) || want.endsWith(`/${rel}`)) score = 3
      else if (name === want || name === wantBase) score = 2
      else if (rel.endsWith(`/${wantBase}`)) score = 1
      if (score) hits.push({ file: item, group, score, kind: fileKind(item) })
    }
  }
  if (!hits.length) return null
  hits.sort((a, b) => b.score - a.score || (a.kind === 'ok' ? -1 : 1) || 0)
  return hits[0]
}

export function jumpErrorForHit(hit, file) {
  if (!hit) return `未找到文件：${file || ''}`
  if (hit.kind === 'outside') return '工作区外文件不能打开'
  if (hit.kind === 'missing') return '文件缺失，无法打开'
  if (hit.kind === 'unread') return '文件不可读，无法打开'
  return ''
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
