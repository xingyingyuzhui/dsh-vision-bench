// @ts-check
/**
 * Agent-facing result projection. Host/UI and `runVisionBench` keep full payloads;
 * production `vision_bench` execute projects after dispatch and before finalize.
 */
import { AGENT_FRAMES_MAX_LIMIT, AGENT_TEXT_CAPS, utf8ByteLength } from './agent-result-caps.mjs'
import {
  projectAlarm,
  projectConfig,
  projectFrames,
  projectTrend,
} from './agent-result-project-rest.mjs'
import { enforceBudget, projectRead, projectStatus } from './agent-result-project-status-read.mjs'

export { AGENT_FRAMES_MAX_LIMIT, AGENT_TEXT_CAPS, utf8ByteLength }

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
 * @param {any} value
 * @param {string[]} [path]
 * @returns {{ path: string[], length: number } | null}
 */
function findLongestArray(value, path = []) {
  if (Array.isArray(value)) {
    return value.length > 1 ? { path, length: value.length } : null
  }
  if (!value || typeof value !== 'object') return null
  /** @type {{ path: string[], length: number } | null} */
  let best = null
  for (const [key, child] of Object.entries(value)) {
    const hit = findLongestArray(child, path.concat(key))
    if (hit && (!best || hit.length > best.length)) best = hit
  }
  return best
}

/**
 * @param {any} root
 * @param {string[]} path
 */
function halveAt(root, path) {
  const next = { ...root }
  /** @type {any} */
  let cursor = next
  for (let i = 0; i < path.length - 1; i += 1) {
    const key = path[i]
    const child = cursor[key]
    cursor[key] = Array.isArray(child) ? child.slice() : { ...child }
    cursor = cursor[key]
  }
  const leaf = path[path.length - 1]
  const list = cursor[leaf]
  cursor[leaf] = Array.isArray(list) ? list.slice(0, Math.ceil(list.length / 2)) : list
  return next
}

/**
 * @param {any} result
 * @param {string[]} omittedIds
 */
function syncPointsGetCounts(result, omittedIds) {
  const points = Array.isArray(result.points) ? result.points : []
  /** @type {Record<string, unknown>} */
  const next = {
    ...result,
    points,
    returned: points.length,
    truncated: true,
  }
  if (omittedIds.length) {
    next.omittedIds = omittedIds
    next.hint =
      result.hint ||
      '结果超预算：已截断 points；omittedIds 为因预算未返回的已找到点，可用更小 ids 批次重查；missingIds 仍表示配置不存在'
  }
  return next
}

/**
 * points op=get: shrink points only; keep valueStatus; returned === points.length;
 * budget-dropped ids go to omittedIds (never missingIds).
 * @param {any} result
 */
function projectPointsGet(result) {
  const base = stripWorkspace(result)
  return enforceBudget(
    base,
    AGENT_TEXT_CAPS.listBytes,
    '结果超预算：缩小 ids 批次后再查；omittedIds 是预算截断，不是配置缺失',
    (projected) => {
      let points = Array.isArray(projected.points) ? projected.points.slice() : []
      /** @type {string[]} */
      let omittedIds = Array.isArray(projected.omittedIds)
        ? projected.omittedIds.map(String)
        : []
      let next = syncPointsGetCounts({ ...projected, points }, omittedIds)
      for (let i = 0; i < 12; i += 1) {
        if (utf8ByteLength(next) <= AGENT_TEXT_CAPS.listBytes) return next
        if (points.length <= 1) break
        const keep = Math.max(1, Math.ceil(points.length / 2))
        const dropped = points.slice(keep)
        points = points.slice(0, keep)
        for (const row of dropped) {
          const id = row && typeof row === 'object' ? String(row.id || '').trim() : ''
          if (id) omittedIds.push(id)
        }
        // Preserve per-row valueStatus; only drop whole rows.
        next = syncPointsGetCounts({ ...projected, points, missingIds: projected.missingIds }, omittedIds)
      }
      if (utf8ByteLength(next) <= AGENT_TEXT_CAPS.listBytes) return next
      return next
    },
  )
}

/**
 * @param {any} result
 */
function projectList(result) {
  const base = stripWorkspace(result)
  return enforceBudget(base, AGENT_TEXT_CAPS.listBytes, '结果超预算：缩小范围或分页后再查', (projected) => {
    let next = { ...projected, truncated: true }
    for (let i = 0; i < 12; i += 1) {
      if (utf8ByteLength(next) <= AGENT_TEXT_CAPS.listBytes) return next
      const hit = findLongestArray(next)
      if (!hit) break
      next = halveAt(next, hit.path)
      next.truncated = true
    }
    return next
  })
}

/**
 * @param {any} result
 */
function projectConfigAction(result) {
  const isMutation =
    result.previousConfigVersion != null ||
    (Array.isArray(result.changedPointIds) && result.changedPointIds.length > 0) ||
    (Array.isArray(result.changedVisualizationIds) && result.changedVisualizationIds.length > 0)
  if (isMutation) return projectConfig(result)
  return stripWorkspace(result)
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
    case 'points': {
      const isMutation =
        result.previousConfigVersion != null ||
        (Array.isArray(result.changedPointIds) && result.changedPointIds.length > 0) ||
        (Array.isArray(result.changedVisualizationIds) && result.changedVisualizationIds.length > 0)
      if (isMutation) return projectConfig(result)
      if (String(args?.op || '') === 'get') return projectPointsGet(result)
      return projectList(result)
    }
    case 'visualization': {
      const isMutation =
        result.previousConfigVersion != null ||
        (Array.isArray(result.changedPointIds) && result.changedPointIds.length > 0) ||
        (Array.isArray(result.changedVisualizationIds) && result.changedVisualizationIds.length > 0)
      if (isMutation) return projectConfig(result)
      return projectList(result)
    }
    case 'config':
    case 'configureConnection':
      return projectConfigAction(result)
    case 'ls':
    case 'map':
    case 'build':
      return projectList(result)
    case 'select':
      return stripWorkspace(result)
    case 'write':
      return projectWrite(result)
    case 'manual':
    case 'connect':
    case 'openConnection':
    case 'closeConnection':
    case 'focus':
    case 'focus.get':
    case 'timeline.list':
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
