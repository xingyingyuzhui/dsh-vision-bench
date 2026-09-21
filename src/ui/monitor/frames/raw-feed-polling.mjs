import { parseFramePortSelection, rawLineId } from '../../../domain/modbus/frames-model.mjs'

/**
 * Poll raw serial feed with epoch-aware cursor reset.
 * @param {{
 *   post: Function,
 *   realCwd: string,
 *   sessionId?: string,
 *   selection: string,
 *   rawCursorRef: { current: number },
 *   feedEpochRef: { current: string },
 *   setSerial: Function,
 * }} deps
 * @returns {() => void} stop
 */
export function startRawFeedPolling(deps) {
  const { post, realCwd, sessionId, selection, rawCursorRef, feedEpochRef, setSerial } = deps
  let stop = false
  rawCursorRef.current = 0
  feedEpochRef.current = ''
  setSerial((s) => ({ ...s, lines: [], lastId: 0, lastAt: 0, error: '', feedEpoch: '' }))

  const applyFeed = (data, epoch) => {
    const incoming = Array.isArray(data.lines) ? data.lines : []
    const nextCursor = Number(data.lastId)
    if (Number.isFinite(nextCursor) && nextCursor > 0) rawCursorRef.current = nextCursor
    setSerial((prev) => {
      const base = epoch && prev.feedEpoch && epoch !== prev.feedEpoch ? [] : prev.lines
      const seen = new Set()
      const lines = []
      for (const l of base.concat(incoming)) {
        const id = rawLineId(l.port, l, 0)
        if (seen.has(id)) continue
        seen.add(id)
        lines.push(l)
      }
      const lastAt = lines.reduce((m, l) => Math.max(m, Number(l.at || l.t || 0)), 0)
      return {
        ...prev,
        feedEpoch: epoch || prev.feedEpoch || '',
        lastId: Number.isFinite(nextCursor) && nextCursor > 0 ? nextCursor : prev.lastId,
        lastAt,
        lines: lines.slice(-2000),
        error: data.error || '',
      }
    })
  }

  const requestFeed = (since) => {
    const selNow = parseFramePortSelection(selection)
    return post(
      '/dsh-vision-bench/serial/feed',
      {
        cwd: realCwd,
        sessionId: sessionId || undefined,
        connectionId: selNow.kind === 'conn' ? selNow.connectionId : '',
        since,
      },
      10000,
    )
  }

  const pull = () => {
    requestFeed(rawCursorRef.current)
      .then((data) => {
        if (stop || !data) return
        const epoch = data.epoch != null ? String(data.epoch) : ''
        if (epoch && feedEpochRef.current && epoch !== feedEpochRef.current) {
          rawCursorRef.current = 0
          feedEpochRef.current = epoch
          setSerial({ lines: [], lastId: 0, lastAt: 0, error: '', feedEpoch: epoch })
          return requestFeed(0).then((fresh) => {
            if (stop || !fresh) return
            applyFeed(fresh, epoch)
          })
        }
        if (epoch) feedEpochRef.current = epoch
        applyFeed(data, epoch)
      })
      .catch(() => {})
  }

  pull()
  const timer = setInterval(pull, 700)
  return () => {
    stop = true
    clearInterval(timer)
  }
}
