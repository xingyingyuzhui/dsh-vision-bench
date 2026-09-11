export function framePayloadHex(frame) {
  const f = frame || {}
  const raw = String(f.hex || f.request || f.response || f.text || f.line || '')
  return raw.replace(/[^0-9a-f]/gi, '')
}

export function formatHexDisplay(hex) {
  const clean = String(hex || '')
    .replace(/[^0-9a-f]/gi, '')
    .toUpperCase()
  return clean.replace(/(.{2})/g, '$1 ').trim()
}

export function hexToUtf8Preview(hex) {
  const clean = String(hex || '').replace(/[^0-9a-f]/gi, '')
  if (!clean) return ''
  const bytes = []
  for (let i = 0; i + 1 < clean.length; i += 2) bytes.push(Number.parseInt(clean.slice(i, i + 2), 16))
  try {
    return new TextDecoder('utf-8', { fatal: false }).decode(new Uint8Array(bytes))
  } catch {
    return bytes.map((b) => (b >= 32 && b < 127 ? String.fromCharCode(b) : '·')).join('')
  }
}

export function frameByteCount(frame) {
  const f = frame || {}
  const n = Number(f.bytes || f.byteLength)
  if (Number.isFinite(n) && n > 0) return n
  const hex = framePayloadHex(f)
  return hex ? Math.floor(hex.length / 2) : 0
}

export function frameDirection(frame) {
  const d = String(frame?.direction || 'tx').toLowerCase()
  return d === 'rx' || d === 'in' || d === 'recv' ? 'rx' : 'tx'
}

export function formatFrameClock(ts) {
  const d = new Date(ts || Date.now())
  if (Number.isNaN(d.getTime())) return '—'
  const pad = (n, w = 2) => String(n).padStart(w, '0')
  return `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`
}

/**
 * Format port display string, ensuring full COM port representation (e.g. COM1, COM2)
 * rather than internal shorthand (e.g. c1, C1).
 * @param {any} frame
 * @param {any[]} [connections]
 * @returns {string}
 */
export function formatPortName(frame, connections = []) {
  const f = frame || {}
  const rawPort = String(f.port || '').trim()
  const connId = String(f.connectionId || '').trim()

  if (/^COM\d+/i.test(rawPort)) {
    return rawPort.toUpperCase()
  }

  const conns = Array.isArray(connections) ? connections : []
  const conn = conns.find((c) => c && (c.id === connId || c.id === rawPort || c.name === rawPort))
  const connPort = String(conn?.conn?.port || '').trim()
  if (connPort) {
    const cMatch = connPort.match(/^c(\d+)$/i)
    if (cMatch) return `COM${cMatch[1]}`
    return connPort.toUpperCase()
  }

  const candidate = rawPort || connId
  const match = candidate.match(/^c(\d+)$/i)
  if (match) {
    return `COM${match[1]}`
  }

  const connName = String(conn?.name || '').trim()
  const nameMatch = connName.match(/^c(\d+)$/i)
  if (nameMatch) {
    return `COM${nameMatch[1]}`
  }

  return rawPort || connId || '—'
}
