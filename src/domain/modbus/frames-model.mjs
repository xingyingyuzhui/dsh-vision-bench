// @ts-check
// Selection: "all" | "conn:<id>". Frames page never opens ports.

/**
 * @param {any} [value]
 * @returns {any}
 */
export function parseFramePortSelection(value) {
  if (typeof value !== 'string' || value === '' || value === 'all') {
    return { kind: 'all', connectionId: '', port: '' }
  }
  if (value.startsWith('conn:')) {
    return { kind: 'conn', connectionId: value.slice(5), port: '' }
  }
  return { kind: 'all', connectionId: '', port: '' }
}

/**
 * @param {any} [connections]
 * @param {any} [serialPorts]
 * @param {any} [mode]
 * @param {any} [liveSources]
 * @returns {any}
 */
export function buildFramePortOptions(connections, serialPorts, mode, liveSources) {
  void serialPorts
  void mode
  const live = Array.isArray(liveSources) ? liveSources : []
  const conns = Array.isArray(connections) ? connections : []
  const byId = new Map(conns.map((/** @type {any} */ c) => [c.id, c]))
  const opts = [{ value: 'all', label: '全部串口', kind: 'all', connectionId: '', port: '' }]
  for (const src of live) {
    if (!src || src.state !== 'connected') continue
    const c = byId.get(src.connectionId)
    if (c && c.conn && c.conn.mode === 'tcp') continue
    if (c && c.conn && c.conn.sim) continue
    const port = src.port || (c && c.conn && c.conn.port) || ''
    if (!port) continue
    opts.push({
      value: 'conn:' + src.connectionId,
      label: port + ' · ' + ((c && c.name) || src.name || src.connectionId) + ' · 已连接',
      kind: 'connected',
      connectionId: src.connectionId,
      port: String(port),
    })
  }
  return opts
}

/**
 * @param {any} [framesByConnection]
 * @param {any} [selection]
 * @returns {any}
 */
export const selectProtocolFrames = (framesByConnection, selection) => {
  const sel =
    typeof selection === 'object' && selection !== null
      ? parseFramePortSelection(selection.value)
      : parseFramePortSelection(selection)
  const map = framesByConnection && typeof framesByConnection === 'object' ? framesByConnection : {}
  if (sel.kind === 'conn') {
    return Array.isArray(map[sel.connectionId]) ? map[sel.connectionId].slice() : []
  }
  const all = []
  for (const cid of Object.keys(map)) {
    const arr = map[cid]
    if (Array.isArray(arr)) for (const f of arr) all.push(f)
  }
  all.sort((a, /** @type {any} */ b) => (a && (a.t || a.at || 0)) - (b && (b.t || b.at || 0)))
  return all
}

/**
 * @param {any} [persisted]
 * @param {any} [memory]
 * @param {any} [limit]
 * @returns {any}
 */
export const mergeFramesDedup = (persisted, memory, limit = 500) => {
  const byId = new Map()
  /**
   * @param {any} [arr]
   * @returns {any}
   */
  const push = (arr) => {
    if (!Array.isArray(arr)) return
    for (const f of arr) {
      if (!f) continue
      const id = f.frameId || f.id
      if (id == null) continue
      byId.set(String(id), f)
    }
  }
  push(persisted)
  push(memory)
  const out = [...byId.values()]
  out.sort((a, /** @type {any} */ b) => (a.t || a.at || 0) - (b.t || b.at || 0))
  return out.slice(-limit)
}

/**
 * @param {any} [scrollTop]
 * @param {any} [scrollHeight]
 * @param {any} [clientHeight]
 * @param {any} [threshold]
 * @returns {any}
 */
export const framesShouldStickToBottom = (scrollTop, scrollHeight, clientHeight, threshold = 5) =>
  scrollHeight - scrollTop - clientHeight <= threshold

/**
 * @param {any} [prevIds]
 * @param {any} [nextFrames]
 * @returns {any}
 */
export const countAddedFrameIds = (prevIds, nextFrames) => {
  const prev = prevIds instanceof Set ? prevIds : new Set(prevIds || [])
  let added = 0
  for (const f of Array.isArray(nextFrames) ? nextFrames : []) {
    const id = typeof f === 'string' || typeof f === 'number' ? String(f) : f && (f.frameId || f.id)
    if (id != null && id !== '' && !prev.has(String(id))) added += 1
  }
  return added
}

/**
 * @param {any} [mode]
 * @param {any} [selection]
 * @returns {any}
 */
export const frameStreamKey = (mode, selection) => {
  const sel = parseFramePortSelection(selection)
  return String(mode || 'proto') + ':' + (sel.kind === 'conn' ? sel.connectionId : 'all')
}

/**
 * @param {any} [port]
 * @param {any} [line]
 * @param {any} [index]
 * @returns {any}
 */
export const rawLineId = (port, line, index) => {
  if (line && line.id != null)
    return String(line.connectionId || port || '') + ':' + String(line.epoch || '') + ':' + String(line.id)
  return String(port || 'raw') + ':' + String((line && (line.t || line.at)) || 0) + ':' + String(index || 0)
}

/**
 * @param {any} [value]
 * @param {any} [connections]
 * @returns {any}
 */
export function resolveFrameSelection(value, connections) {
  const sel = parseFramePortSelection(value)
  if (sel.kind !== 'conn') return { ...sel, port: '' }
  const conn = (Array.isArray(connections) ? connections : []).find((/** @type {any} */ c) => c && c.id === sel.connectionId)
  return { ...sel, port: conn && conn.conn && conn.conn.port ? String(conn.conn.port) : '' }
}
