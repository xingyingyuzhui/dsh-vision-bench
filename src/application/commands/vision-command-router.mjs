// @ts-check
import { requireWorkspaceCwd } from '../../../bench-paths.mjs'
import { touchServiceSession } from '../../../bench-store.mjs'
import { handleConfigCommand } from './handlers/config-command-handler.mjs'
import { handleEvidenceCommand } from './handlers/evidence-command-handler.mjs'
import { handleLiveCommand } from './handlers/live-command-handler.mjs'
import { compactLog, compactProjectMap, handleProjectCommand } from './handlers/project-command-handler.mjs'
import { handleSystemCommand } from './handlers/system-command-handler.mjs'
import { handleVisualizationCommand } from './handlers/visualization-command-handler.mjs'

export const ACTIONS = new Set([
  'status',
  'ls',
  'select',
  'build',
  'read',
  'write',
  'map',
  'manual',
  'connect',
  'config',
  'points',
  'frames',
  'focus',
  'trend',
  'visualization',
  'alarm',
  'evidence',
  'configureConnection',
  'openConnection',
  'closeConnection',
  'system.ping',
])

/**
 * @param {any} agent
 * @returns {string}
 */
export const cwdOf = (agent) => {
  const session = agent?.session
  const header = session?.header
  return header?.cwd ? String(header.cwd) : ''
}

/**
 * @param {any} agent
 * @returns {string}
 */
export const sessionIdOf = (agent) => {
  const session = agent?.session
  const header = session?.header
  if (header?.id) return String(header.id)
  if (session?.id) return String(session.id)
  return ''
}

/**
 * @param {any} input
 * @returns {{ source: 'agent' | 'user', sessionId: string }}
 */
const originFrom = (input) => ({
  source: input && input.source === 'agent' ? 'agent' : 'user',
  sessionId: input?.sessionId ? String(input.sessionId) : '',
})

/** @param {any} action */
function unknownAction(action) {
  return {
    ok: false,
    action,
    errorCode: 'UNKNOWN_ACTION',
    error:
      'action 必须是 status | ls | select | build | read | write | map | manual | connect | config | points | frames | focus | trend | visualization | alarm | evidence | configureConnection | openConnection | closeConnection | system.ping',
  }
}

/**
 * @param {any} home
 * @param {any} args
 * @param {any} cwd
 * @param {any} originInput
 * @param {any} opts
 * @returns {Promise<any>}
 */
export async function runVisionBench(home, args, cwd, originInput, opts) {
  const action = args?.action
  if (action === 'draft') {
    return {
      ok: false,
      action,
      errorCode: 'OP_REMOVED',
      error: '配置草稿已移除；配置修改请直接调用 points/visualization/configureConnection',
    }
  }

  const systemRan = await handleSystemCommand({ home, args, cwd, originInput, opts })
  if (systemRan) return systemRan

  if (!ACTIONS.has(action)) return unknownAction(action)

  const room = requireWorkspaceCwd(cwd)
  if (room.error) return { ok: false, action, error: room.error }
  const origin = originFrom(originInput)
  const signal = opts?.signal
  if (signal?.aborted) return { ok: false, action, cancelled: true, error: '已取消' }
  if (origin.sessionId) await touchServiceSession(home, room.cwd, origin.sessionId)

  const handlers = [
    handleConfigCommand,
    handleProjectCommand,
    handleLiveCommand,
    handleVisualizationCommand,
    handleEvidenceCommand,
  ]
  for (const handler of handlers) {
    const ran = await handler(home, args, room, origin, opts)
    if (ran) return ran
  }
  return unknownAction(action)
}

export const _internal = { ACTIONS, compactLog, compactProjectMap, originFrom }
