// bench-frames-model.mjs — pure, testable identity/selection helpers for the
// serial-frame sidebar (Task2/0.18.1). No React/DOM here.
//
// Selection values use an explicit internal type:
//   "all"            → every connection merged by time
//   "conn:<id>"      → protocol frames of a configured connection
//   "raw:<port>"     → unconfigured serial port (raw-data mode only)

export function parseFramePortSelection(value) {
  if (typeof value !== 'string' || value === '' || value === 'all') {
    return { kind: 'all', connectionId: '', port: '' }
  }
  if (value.startsWith('conn:')) {
    return { kind: 'conn', connectionId: value.slice(5), port: '' }
  }
  if (value.startsWith('raw:')) {
    return { kind: 'raw', connectionId: '', port: value.slice(4) }
  }
  // Unknown → treat as all (never key a cache by a display COM name).
  return { kind: 'all', connectionId: '', port: '' }
}

// connections: v3 normalized [{id, name, conn:{mode,port,...}}]
// serialPorts: array of port names (strings) — from /serial/ports
// mode: 'proto' | 'raw'
export function buildFramePortOptions(connections, serialPorts, mode) {
  const conns = Array.isArray(connections) ? connections : []
  const configured = conns.filter((c) => c && c.conn && c.conn.mode === 'rtu' && c.conn.port)
  const opts = [{ value: 'all', label: '全部串口', kind: 'all', connectionId: '', port: '' }]
  for (const c of configured) {
    opts.push({
      value: 'conn:' + c.id,
      label: c.conn.port + ' · ' + (c.name || c.id),
      kind: 'configured',
      connectionId: c.id,
      port: String(c.conn.port),
    })
  }
  if (mode === 'raw' && Array.isArray(serialPorts)) {
    const byPort = new Set(configured.map((c) => String(c.conn.port).toLowerCase()))
    for (const raw of serialPorts) {
      const p = String(raw)
      if (byPort.has(p.toLowerCase())) continue
      opts.push({ value: 'raw:' + p, label: p + ' · 未配置COM', kind: 'unconfigured', connectionId: '', port: p })
    }
  }
  return opts
}

// framesByConnection: { connId: Frame[] } — authoritative persisted data.
// selection: a value string ('all' | 'conn:<id>' | 'raw:<port>') or option object.
// Returns a merged, time-sorted array for 'all', or the connection's slice.
export function selectProtocolFrames(framesByConnection, selection) {
  const sel = typeof selection === 'object' && selection !== null
    ? parseFramePortSelection(selection.value)
    : parseFramePortSelection(selection)
  const map = framesByConnection && typeof framesByConnection === 'object' ? framesByConnection : {}
  if (sel.kind === 'conn') {
    return Array.isArray(map[sel.connectionId]) ? map[sel.connectionId].slice() : []
  }
  // 'all': merge all connections, sort by time
  const all = []
  for (const cid of Object.keys(map)) {
    const arr = map[cid]
    if (Array.isArray(arr)) for (const f of arr) all.push(f)
  }
  all.sort((a, b) => (a && (a.t || a.at || 0)) - (b && (b.t || b.at || 0)))
  return all
}

// Merge persisted authoritative frames with the real-time memory cache,
// deduping by stable frameId. Last writer wins: memory (pushed after persisted)
// reflects the freshest data; after reload memory is empty so persisted stands.
export function mergeFramesDedup(persisted, memory, limit = 500) {
  const byId = new Map()
  const push = (arr) => {
    if (!Array.isArray(arr)) return
    for (const f of arr) {
      if (!f) continue
      const id = f.frameId || f.id
      if (id) {
        byId.set(id, f)
      } else {
        const key = (f.t || f.at || 0) + ':' + Math.random().toString(36).slice(2, 7)
        byId.set(key, f)
      }
    }
  }
  push(persisted)
  push(memory)
  const out = Array.from(byId.values())
  out.sort((a, b) => (a && (a.t || a.at || 0)) - (b && (b.t || b.at || 0)))
  return limit > 0 ? out.slice(-limit) : out
}

// Auto-follow only when the user is already at the bottom.
export function framesShouldStickToBottom(scrollTop, scrollHeight, clientHeight, threshold = 5) {
  return scrollHeight - scrollTop - clientHeight <= threshold
}

// Task3/0.18.2: resolve a selection against real connections so raw mode can
// open a CONFIGURED connection's port. Returns {kind, connectionId, port}.
export function resolveFrameSelection(selection, connections, options) {
  const sel = typeof selection === 'object' && selection !== null
    ? parseFramePortSelection(selection.value)
    : parseFramePortSelection(selection)
  const mode = options && options.mode
  const conns = Array.isArray(connections) ? connections : []
  if (sel.kind === 'conn') {
    const c = conns.find((cc) => cc && cc.id === sel.connectionId)
    const port = c && c.conn && c.conn.mode === 'rtu' ? String(c.conn.port || '') : ''
    if (mode === 'raw' && port) return { kind: 'conn', connectionId: sel.connectionId, port }
    if (mode === 'raw' && !port) return { kind: 'all', connectionId: '', port: '' }
    return { kind: 'conn', connectionId: sel.connectionId, port }
  }
  if (sel.kind === 'raw') {
    // Task3: raw selections are only valid in raw mode; proto mode degrades to all
    if (mode === 'proto') return { kind: 'all', connectionId: '', port: '' }
    return { kind: 'raw', connectionId: '', port: sel.port }
  }
  return { kind: 'all', connectionId: '', port: '' }
}

// Task5/0.18.3: exactly how many NEW frame ids arrived since the previous set.
// Untouched data → 0 (never shows "460 条新增" for 500 identical frames); a ring
// shift f0..f499 → f1..f500 reports exactly 1.
export function countAddedFrameIds(previousIds, currentIds) {
  const prev = previousIds instanceof Set
    ? previousIds
    : new Set(Array.isArray(previousIds) ? previousIds : [])
  let added = 0
  for (const id of Array.isArray(currentIds) ? currentIds : []) {
    if (id != null && !prev.has(id)) added++
  }
  return added
}

// Task5/0.18.3: a data-stream identity strictly separates proto/raw and each
// selection so cursors never leak between COM/connections/modes.
export function frameStreamKey(mode, selection) {
  const sel = typeof selection === 'object' && selection !== null
    ? parseFramePortSelection(selection.value)
    : parseFramePortSelection(selection)
  const kind = sel.kind || 'all'
  if (mode === 'raw') {
    if (kind === 'conn') return 'raw|conn|' + sel.connectionId
    return 'raw|' + (sel.port || 'all')
  }
  if (kind === 'conn') return 'proto|conn|' + sel.connectionId
  if (kind === 'all') return 'proto|all'
  return 'proto|' + kind
}

// Task5/0.18.3: stable id for a raw serial line (never array index).
export function rawLineId(port, line, index) {
  const base = line && (line.id || line.lineId)
  if (base != null) return 'raw:' + String(port) + ':' + String(base)
  return 'raw:' + String(port) + ':' + String(line && (line.t || line.at) || 0) + ':' + String(index || 0)
}
