import {
  mergeFramesDedup,
  projectTransactionsToWireFrames,
  rawLineId,
  selectProtocolFrames,
} from '../../../domain/modbus/frames-model.mjs'
import { getFramesLog } from '../../common/frame-cache.mjs'
import {
  formatFrameClock,
  formatHexDisplay,
  formatPortName,
  frameDirection,
  framePayloadHex,
} from './frames-format.mjs'

/**
 * Map one raw serial feed line into the shared frame row shape used by the table.
 * @param {any} line
 * @param {number} idx
 * @param {{ connectionId?: string }} sel
 */
export function mapSerialLineToFrame(line, idx, sel) {
  const l = line || {}
  const id = rawLineId(l.port, l, idx)
  return {
    t: l.at || l.t,
    at: l.at || l.t,
    request: l.hex || l.text || l.line || '',
    response: '',
    hex: l.hex,
    bytes: l.byteLength || l.bytes,
    id,
    frameId: id,
    label: (l.hex || '').slice(0, 24),
    direction: l.direction || 'rx',
    status: 'ok',
    connectionId: l.connectionId || sel.connectionId || '',
    port: l.port,
    source: l.source || '',
    deviceId: '',
    functionCode: 0,
  }
}

/**
 * Build the live (unpaused) frame list for the current mode/selection.
 * @param {{
 *   mode: string,
 *   sel: { kind: string, connectionId?: string },
 *   framesByConnection: Record<string, any[]>,
 *   frameScope: { cwd?: string, sessionId?: string, isShared?: boolean },
 *   serial: { lines?: any[] },
 *   connections?: any[],
 *   viewClearedAt: number,
 * }} opts
 */
export function simConnectionIds(connections, sel) {
  const ids = (Array.isArray(connections) ? connections : [])
    .filter((c) => c && c.id && (c.conn?.sim === true || c.sim === true))
    .map((c) => c.id)
  if (sel?.kind === 'conn') return ids.includes(sel.connectionId) ? [sel.connectionId] : []
  return ids
}

export function buildLiveFrames(opts) {
  const { mode, sel, framesByConnection, frameScope, serial, connections, viewClearedAt } = opts
  let liveFrames = []
  if (mode === 'proto') {
    if (sel.kind === 'conn') {
      const persistedArray = framesByConnection[sel.connectionId]
      const mem = getFramesLog(frameScope, sel.connectionId)
      liveFrames = projectTransactionsToWireFrames(mergeFramesDedup(persistedArray, mem, 500))
    } else {
      liveFrames = projectTransactionsToWireFrames(
        mergeFramesDedup(selectProtocolFrames(framesByConnection, 'all'), getFramesLog(frameScope), 1000),
      )
    }
  } else {
    const lines = Array.isArray(serial?.lines) ? serial.lines : []
    liveFrames = lines.map((l, idx) => mapSerialLineToFrame(l, idx, sel))
    const simIds = simConnectionIds(connections, sel)
    if (simIds.length) {
      const simMap = {}
      for (const id of simIds) simMap[id] = framesByConnection?.[id] || []
      const simWire = projectTransactionsToWireFrames(selectProtocolFrames(simMap, 'all'))
      liveFrames = mergeFramesDedup(liveFrames, simWire, 2000)
    }
  }
  if (viewClearedAt > 0) {
    liveFrames = liveFrames.filter((f) => (f.t || f.at || 0) > viewClearedAt)
  }
  return liveFrames
}

/**
 * Displayed rows: frozen snapshot while paused, otherwise the live list.
 * @param {boolean} paused
 * @param {Record<string, any[]>|null} pausedSnapshot
 * @param {string} mode
 * @param {any[]} liveFrames
 */
export function pickDisplayedFrames(paused, pausedSnapshot, mode, liveFrames) {
  return paused && pausedSnapshot ? pausedSnapshot[mode] || [] : liveFrames
}

/**
 * @param {any[]} filtered
 * @param {any[]} connections
 */
export function framesAsText(filtered, connections) {
  return filtered
    .map((f) => {
      const dir = frameDirection(f)
      const hex = formatHexDisplay(framePayloadHex(f))
      return `${formatFrameClock(f.t || f.at)} ${formatPortName(f, connections)} ${dir} ${hex}`
    })
    .join('\n')
}

/**
 * @param {any[]} filtered
 */
export function framesAsJson(filtered) {
  return filtered.map((f) => JSON.stringify(f)).join('\n')
}

/**
 * Trigger a browser download for the current export payload.
 * @param {'json'|'txt'} kind
 * @param {string} text
 * @returns {string|null} suggested filename, or null when empty
 */
export function downloadFramesFile(kind, text) {
  if (!text) return null
  const d = new Date()
  const p = (n) => String(n).padStart(2, '0')
  const stamp = `${d.getFullYear()}${p(d.getMonth() + 1)}${p(d.getDate())}-${p(d.getHours())}${p(d.getMinutes())}${p(d.getSeconds())}`
  const name = kind === 'json' ? `serial-frames-${stamp}.json` : `serial-frames-${stamp}.txt`
  const blob = new Blob([text], { type: kind === 'json' ? 'application/json' : 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = name
  a.click()
  URL.revokeObjectURL(url)
  return name
}
