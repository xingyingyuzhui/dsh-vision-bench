// @ts-check
/**
 * Agent-facing result projection. Host/UI and `runVisionBench` keep full payloads;
 * production `vision_bench` execute projects after dispatch and before finalize.
 */
import {
  projectAlarm,
  projectConfig,
  projectFrames,
  projectTrend,
} from './agent-result-project-rest.mjs'
import { projectRead, projectStatus } from './agent-result-project-status-read.mjs'

export { AGENT_FRAMES_MAX_LIMIT, AGENT_TEXT_CAPS, utf8ByteLength } from './agent-result-caps.mjs'

const CONFIG_ACTIONS = new Set(['points', 'config', 'configureConnection', 'visualization'])

/**
 * Pending writes must not hand the model the endpoint fingerprint inside `request`.
 * @param {any} result
 */
function projectWrite(result) {
  if (!result || result.needsConfirm !== true) {
    if (result && 'workspace' in result) {
      const { workspace: _workspace, ...rest } = result
      void _workspace
      return rest
    }
    return result
  }
  /** @type {Record<string, unknown>} */
  const projected = {
    ok: false,
    needsConfirm: true,
    errorCode: result.errorCode,
    requestId: result.requestId,
    label: result.label,
    nextStep: result.nextStep,
  }
  if (result.error !== undefined) projected.error = result.error
  if (result.deduped === true) projected.deduped = true
  return projected
}

/**
 * @param {any} args
 * @param {any} result
 * @returns {any}
 */
export function projectAgentResult(args, result) {
  if (!result || typeof result !== 'object' || Array.isArray(result)) return result
  const action = String(args?.action || result.action || '')

  switch (action) {
    case 'status':
      return projectStatus(args, result)
    case 'read':
      return projectRead(args, result)
    case 'frames':
      return projectFrames(args, result)
    case 'trend':
      return projectTrend(args, result)
    case 'alarm':
      return projectAlarm(args, result)
    case 'points':
    case 'config':
    case 'configureConnection':
    case 'visualization': {
      const isMutation =
        result.previousConfigVersion != null ||
        (Array.isArray(result.changedPointIds) && result.changedPointIds.length > 0) ||
        (Array.isArray(result.changedVisualizationIds) && result.changedVisualizationIds.length > 0)
      if (isMutation) return projectConfig(result)
      if ('workspace' in result) {
        const { workspace: _workspace, ...rest } = result
        void _workspace
        return rest
      }
      return result
    }
    case 'ls':
    case 'select':
    case 'build':
    case 'map':
    case 'write':
      return projectWrite(result)
    case 'manual':
    case 'connect':
    case 'openConnection':
    case 'closeConnection':
    case 'focus':
    case 'evidence':
    case 'system.ping':
      if ('workspace' in result) {
        const { workspace: _workspace, ...rest } = result
        void _workspace
        return rest
      }
      return result
    default: {
      if (CONFIG_ACTIONS.has(action)) return projectConfig(result)
      if ('workspace' in result) {
        const { workspace: _workspace, ...rest } = result
        void _workspace
        return rest
      }
      return result
    }
  }
}
