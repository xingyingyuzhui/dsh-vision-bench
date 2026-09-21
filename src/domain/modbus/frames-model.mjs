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
  const isProto = mode === 'proto' || mode === 'protocol'
  const live = Array.isArray(liveSources) ? liveSources : []
  const conns = Array.isArray(connections) ? connections : []
  const byId = new Map(conns.map((/** @type {any} */ c) => [c.id, c]))
  const opts = [{ value: 'all', label: isProto ? '全部连接' : '全部串口', kind: 'all', connectionId: '', port: '' }]
  if (isProto) {
    for (const c of conns) {
      if (!c || !c.id) continue
      const port = String(c.conn?.port || c.conn?.host || '') || c.id
      const bits = [port, c.name || c.id]
      if (c.conn?.mode === 'tcp') bits.push('TCP')
      if (c.conn?.sim) bits.push('仿真')
      if (c.enabled === false) bits.push('已禁用')
      opts.push({
        value: 'conn:' + c.id,
        label: bits.filter(Boolean).join(' · '),
        kind: 'configured',
        connectionId: c.id,
        port: String(port),
      })
    }
    return opts
  }
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

/** @param {any} value */
const asHex = (value) =>
  String(value || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase()

/**
 * Project one persisted TransactionRecord into WireFrameRow(s) for the UI/Agent.
 * Storage stays one row per Modbus transaction; display splits TX/RX on wire.
 * @param {any} tx
 * @returns {any[]}
 */
export function projectTransactionToWireFrames(tx) {
  if (!tx || typeof tx !== 'object') return []
  if (tx.wireRole === 'tx' || tx.wireRole === 'rx') return [tx]
  const tid = String(tx.transactionId || tx.id || tx.frameId || '')
  const reqHex = asHex(tx.requestHex || tx.request)
  const resHex = asHex(tx.responseHex || tx.response)
  /** @type {any[]} */
  const rows = []
  const base = {
    ...tx,
    transactionId: tid || String(tx.id || ''),
  }
  if (reqHex || tx.request || !resHex) {
    const id = tid ? `${tid}:tx` : `${String(tx.id || 'frame')}:tx`
    rows.push({
      ...base,
      id,
      frameId: id,
      direction: 'tx',
      wireRole: 'tx',
      hex: reqHex,
      request: tx.request || '',
      response: '',
      requestHex: reqHex || tx.requestHex || '',
      responseHex: '',
    })
  }
  if (resHex || tx.response) {
    const id = tid ? `${tid}:rx` : `${String(tx.id || 'frame')}:rx`
    rows.push({
      ...base,
      id,
      frameId: id,
      direction: 'rx',
      wireRole: 'rx',
      hex: resHex,
      request: '',
      response: tx.response || '',
      requestHex: '',
      responseHex: resHex || tx.responseHex || '',
    })
  }
  return rows
}

/**
 * @param {any} [list]
 * @returns {any[]}
 */
export function projectTransactionsToWireFrames(list) {
  const out = []
  for (const tx of Array.isArray(list) ? list : []) {
    for (const row of projectTransactionToWireFrames(tx)) out.push(row)
  }
  return out
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

/** Newest-first list: auto-follow while the viewport is near the top. */
export const framesShouldStickToTop = (scrollTop, threshold = 5) => Number(scrollTop) <= threshold

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
