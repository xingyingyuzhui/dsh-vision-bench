// @ts-check
import { AGENT_TEXT_CAPS, utf8ByteLength } from './agent-result-caps.mjs'
import { resultTooLarge } from './agent-result-project-rest.mjs'

/**
 * @param {any} result
 */
function stripWorkspace(result) {
  if (result && typeof result === 'object' && 'workspace' in result) {
    const { workspace: _workspace, ...rest } = result
    void _workspace
    return rest
  }
  return result
}

/**
 * Shrink a timeline page on whole-event boundaries. The cursor is the last
 * event actually returned, never the untrimmed page anchor.
 * @param {any} result
 */
export function projectTimelineList(result) {
  if (!result || typeof result !== 'object' || result.ok === false) return stripWorkspace(result)
  const events = Array.isArray(result.events) ? result.events : []
  if (!events.length) return stripWorkspace(result)
  const cap = AGENT_TEXT_CAPS.listBytes
  const hostCursor = typeof result.nextCursor === 'string' && result.nextCursor ? result.nextCursor : null

  for (let k = events.length; k >= 1; k -= 1) {
    const kept = events.slice(0, k)
    const moreInPage = k < events.length
    const lastId = String(kept[k - 1]?.id || '')
    const nextCursor = moreInPage ? lastId || null : hostCursor
    const truncated = moreInPage || nextCursor != null
    const projected = {
      ...stripWorkspace(result),
      events: kept,
      returned: kept.length,
      nextCursor,
      truncated,
    }
    if (utf8ByteLength(projected) <= cap) return projected
  }

  return resultTooLarge({
    action: 'timeline.list',
    commandId: typeof result.commandId === 'string' ? result.commandId : '',
    total: Number(result.total) || events.length,
    eventId: String(events[0]?.id || ''),
  })
}
