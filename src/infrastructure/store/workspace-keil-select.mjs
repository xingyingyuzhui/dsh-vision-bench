// @ts-check
import { isAbsolute } from 'node:path'
import {
  normalizeTimelineEvent,
  prepend,
  trimTimeline,
} from '../../domain/modbus/journal-model.mjs'
import { emptyLog, mergeLog } from '../../domain/prompt/prompt-log.mjs'

const TIMELINE_WINDOW = 360
/**
 * @param {any} timeline
 * @param {any} event
 */
const pushEvent = (timeline, event) => trimTimeline(prepend(timeline, event, TIMELINE_WINDOW))

/**
 * @param {any} workspace
 * @param {any} input
 * @param {any} prev
 * @returns {{ ok: true, workspace: any } | { ok: false, error: string, workspace: any }}
 */
export function recordKeilProjectSelect(workspace, input, prev) {
  const keilProject = workspace.keil.project
  if (keilProject && !isAbsolute(keilProject)) {
    return { ok: false, error: 'keil.project 必须是绝对路径', workspace }
  }
  if (keilProject && keilProject !== prev.keil?.project) {
    const summary = `选择工程 ${keilProject}`
    const origin = {
      source: input?.origin && input.origin.source === 'agent' ? 'agent' : 'user',
      sessionId: input?.origin?.sessionId ? String(input.origin.sessionId) : '',
    }
    workspace.log = mergeLog(workspace.log || emptyLog(), {
      action: 'select-project',
      ok: true,
      summary,
    })
    workspace.timeline = pushEvent(
      workspace.timeline,
      normalizeTimelineEvent({
        kind: 'select-project',
        source: origin.source,
        sessionId: origin.sessionId,
        ok: true,
        summary,
      }),
    )
  }
  return { ok: true, workspace }
}
