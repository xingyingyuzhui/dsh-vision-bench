export function fileKindMark(kind) {
  if (kind === 'outside') return '工作区外'
  if (kind === 'missing') return '缺失'
  if (kind === 'unread') return '不可读'
  return ''
}

export function copyText(text, onDone) {
  const line = String(text || '')
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard?.writeText) {
      navigator.clipboard.writeText(line).catch(() => {})
    }
  } catch {
    /* clipboard optional */
  }
  if (typeof onDone === 'function') onDone(line)
}

/** Page identity: session + cwd + Keil project + target. */
export function projectIdentityKey(sessionId, cwd, keil) {
  const k = keil && typeof keil === 'object' ? keil : {}
  return [String(sessionId || ''), String(cwd || ''), String(k.project || ''), String(k.target || '')].join('\0')
}

export function emptyPreviewState(rel = '', identityKey = '') {
  return { loading: false, rel, text: '', lines: 0, truncated: false, error: '', identityKey }
}

export function tagMappedState(details, identityKey) {
  if (!details) return null
  return { ...details, identityKey }
}

export function matchesIdentity(state, identityKey) {
  return !!state && state.identityKey === identityKey
}

export function projectViewStorageKey(sessionId, cwd) {
  return `dvb-project-view:${String(sessionId || '')}:${String(cwd || '')}`
}

export function loadProjectViewMode(sessionId, cwd) {
  try {
    const v = sessionStorage.getItem(projectViewStorageKey(sessionId, cwd))
    return v === 'graph' ? 'graph' : 'tree'
  } catch {
    return 'tree'
  }
}

export function saveProjectViewMode(sessionId, cwd, mode) {
  try {
    sessionStorage.setItem(projectViewStorageKey(sessionId, cwd), mode === 'graph' ? 'graph' : 'tree')
  } catch {
    /* ignore */
  }
}
