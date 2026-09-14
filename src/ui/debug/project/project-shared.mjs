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
  return !!state && (Boolean(state.isDemo) || state.identityKey === identityKey)
}

let _primitives = null
export function getDshPrimitives() {
  if (_primitives) return _primitives
  try {
    if (typeof require === 'function') {
      _primitives = require('@deepseek-ai/dsh-client-ui-primitives')
      return _primitives
    }
  } catch {}
  return null
}

const _p = (name) => {
  const p = getDshPrimitives()
  return p ? p[name] : null
}

export function renderFolderIcon(React, isOpen = true, size = 16, className = '') {
  const Comp = isOpen ? (_p('IconFolderOpen16') || _p('IconFolderOpenOutline16')) : (_p('IconFolderClose16') || _p('IconFolderOpen16'))
  const cls = `dvb-tree-folder-icon ${className}`.trim()
  if (Comp) return React.createElement(Comp, { size, className: cls })
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', className: cls },
    React.createElement('path', {
      d: isOpen
        ? 'M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v1H3.5a1 1 0 0 0-.96 1.28L3.8 12.5H2a1 1 0 0 1-1-1v-8zm2.6 3.5h10.2l-1.3 5H3.1l1-5z'
        : 'M1.5 3.5a1 1 0 0 1 1-1h3l1.5 1.5H13a1 1 0 0 1 1 1v6.5a1 1 0 0 1-1 1H2.5a1 1 0 0 1-1-1v-8z',
      fill: 'currentColor',
    }),
  )
}

export function renderChevronIcon(React, isOpen = false, size = 12, className = '') {
  const Comp = isOpen ? _p('IconChevronDownOutline14') : _p('IconChevronRightOutline14')
  const cls = `dvb-map-chevron-svg ${className}`.trim()
  if (Comp) return React.createElement(Comp, { size, className: cls })
  return React.createElement(
    'svg',
    { width: size, height: size, viewBox: '0 0 12 12', fill: 'none', className: cls },
    React.createElement('path', {
      d: isOpen ? 'M2.5 4.5l3.5 3.5 3.5-3.5' : 'M4.5 2.5l3.5 3.5-3.5 3.5',
      stroke: 'currentColor',
      strokeWidth: '1.5',
      strokeLinecap: 'round',
      strokeLinejoin: 'round',
    }),
  )
}

export function renderFileIcon(React, size = 14, className = '') {
  const Comp = _p('IconCodeOutline16')
  const cls = `dvb-tree-file-icon ${className}`.trim()
  if (Comp) return React.createElement(Comp, { size, className: cls })
  const el = React.createElement
  return el(
    'svg',
    { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', className: cls },
    el('path', { d: 'M3.5 1.5h6l3.5 3.5v9.5h-9.5z', stroke: 'currentColor', strokeWidth: '1.2' }),
    el('path', { d: 'M9.5 1.5v3.5h3.5', stroke: 'currentColor', strokeWidth: '1.2' }),
  )
}

export function renderEllipsisIcon(React, size = 14) {
  const Comp = _p('IconEllipsisOutline16')
  return Comp ? React.createElement(Comp, { size }) : '⋯'
}

const _pSvg = (React, size, d, sw = '1.2') =>
  React.createElement('svg', { width: size, height: size, viewBox: '0 0 16 16', fill: 'none', stroke: 'currentColor', strokeWidth: sw },
    React.createElement('path', { d }))

export function renderRefreshIcon(React, size = 14) {
  const Comp = _p('IconRefreshOutline16')
  return Comp ? React.createElement(Comp, { size }) : _pSvg(React, size, 'M2 8a6 6 0 1 0 1.5-3.9L1 6.5M1 2.5v4h4', '1.3')
}

export function projectViewStorageKey(sessionId, cwd) {
  return `dvb-project-view:${String(sessionId || '')}:${String(cwd || '')}`
}

export function loadProjectViewMode(sessionId, cwd, fallback = 'tree') {
  try {
    const v = sessionStorage.getItem(projectViewStorageKey(sessionId, cwd))
    return v === 'graph' || v === 'tree' ? v : fallback
  } catch {
    return fallback
  }
}

export function saveProjectViewMode(sessionId, cwd, mode) {
  try {
    sessionStorage.setItem(projectViewStorageKey(sessionId, cwd), mode === 'graph' ? 'graph' : 'tree')
  } catch {
    /* ignore */
  }
}
