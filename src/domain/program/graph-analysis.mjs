// @ts-check

/**
 * Finds all nodes and edges upstream of a target node (influencing the target) up to maxDepth.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} targetId
 * @param {{ maxDepth?: number, includeDataEdges?: boolean }} [options]
 * @returns {{ nodeIds: string[], edgeIds: string[], paths: string[][] }}
 */
export function findUpstream(model, targetId, options = {}) {
  const maxDepth = options.maxDepth || 6
  const includeData = options.includeDataEdges !== false

  const candidateEdges = [
    ...(model.callEdges || []).map((e) => ({ id: e.id, from: String(e.callerId || ''), to: String(e.calleeId || '') })),
    ...(includeData
      ? (model.writeEdges || []).map((e) => ({
          id: e.id,
          from: String(e.accessorId || ''),
          to: String(e.variableId || ''),
        }))
      : []),
    ...(includeData
      ? (model.readEdges || []).map((e) => ({
          id: e.id,
          from: String(e.variableId || ''),
          to: String(e.accessorId || ''),
        }))
      : []),
  ].filter((e) => Boolean(e.from && e.to))

  const visitedNodes = new Set([targetId])
  const visitedEdges = new Set()
  /** @type {string[][]} */
  const paths = []

  /**
   * @param {string} currentId
   * @param {number} depth
   * @param {string[]} currentPath
   */
  function traverse(currentId, depth, currentPath) {
    if (depth >= maxDepth) return

    // Find incoming edges to currentId
    const incoming = candidateEdges.filter((e) => e.to === currentId)
    for (const edge of incoming) {
      visitedEdges.add(edge.id)
      const nextId = edge.from
      const newPath = [nextId, ...currentPath]
      paths.push(newPath)

      if (!visitedNodes.has(nextId)) {
        visitedNodes.add(nextId)
        traverse(nextId, depth + 1, newPath)
      }
    }
  }

  traverse(targetId, 0, [targetId])

  return {
    nodeIds: Array.from(visitedNodes),
    edgeIds: Array.from(visitedEdges),
    paths,
  }
}

/**
 * Finds all nodes and edges downstream of a source node (influenced by the source) up to maxDepth.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} sourceId
 * @param {{ maxDepth?: number, includeDataEdges?: boolean }} [options]
 * @returns {{ nodeIds: string[], edgeIds: string[], paths: string[][] }}
 */
export function findDownstream(model, sourceId, options = {}) {
  const maxDepth = options.maxDepth || 6
  const includeData = options.includeDataEdges !== false

  const candidateEdges = [
    ...(model.callEdges || []).map((e) => ({ id: e.id, from: String(e.callerId || ''), to: String(e.calleeId || '') })),
    ...(includeData
      ? (model.writeEdges || []).map((e) => ({
          id: e.id,
          from: String(e.accessorId || ''),
          to: String(e.variableId || ''),
        }))
      : []),
    ...(includeData
      ? (model.readEdges || []).map((e) => ({
          id: e.id,
          from: String(e.accessorId || ''),
          to: String(e.variableId || ''),
        }))
      : []),
  ].filter((e) => Boolean(e.from && e.to))

  const visitedNodes = new Set([sourceId])
  const visitedEdges = new Set()
  /** @type {string[][]} */
  const paths = []

  /**
   * @param {string} currentId
   * @param {number} depth
   * @param {string[]} currentPath
   */
  function traverse(currentId, depth, currentPath) {
    if (depth >= maxDepth) return

    const outgoing = candidateEdges.filter((e) => e.from === currentId)
    for (const edge of outgoing) {
      visitedEdges.add(edge.id)
      const nextId = edge.to
      const newPath = [...currentPath, nextId]
      paths.push(newPath)

      if (!visitedNodes.has(nextId)) {
        visitedNodes.add(nextId)
        traverse(nextId, depth + 1, newPath)
      }
    }
  }

  traverse(sourceId, 0, [sourceId])

  return {
    nodeIds: Array.from(visitedNodes),
    edgeIds: Array.from(visitedEdges),
    paths,
  }
}

/**
 * Finds a causal path from fromId to toId using BFS across call and data edges.
 *
 * @param {import('../../types/program.d.ts').ProgramModel} model
 * @param {string} fromId
 * @param {string} toId
 * @param {{ includeDataEdges?: boolean, maxHops?: number }} [options]
 * @returns {string[] | null} Array of node IDs forming the shortest path, or null if unreachable
 */
export function findCausalPath(model, fromId, toId, options = {}) {
  if (fromId === toId) return [fromId]
  const maxHops = options.maxHops || 12
  const includeData = options.includeDataEdges !== false

  const candidateEdges = [
    ...(model.callEdges || []).map((e) => ({ from: String(e.callerId || ''), to: String(e.calleeId || '') })),
    ...(includeData
      ? (model.writeEdges || []).map((e) => ({ from: String(e.accessorId || ''), to: String(e.variableId || '') }))
      : []),
    ...(includeData
      ? (model.readEdges || []).map((e) => ({ from: String(e.variableId || ''), to: String(e.accessorId || '') }))
      : []),
  ].filter((e) => Boolean(e.from && e.to))

  // BFS Queue: [currentNodeId, pathSoFar]
  /** @type {Array<[string, string[]]>} */
  const queue = [[fromId, [fromId]]]
  const visited = new Set([fromId])

  while (queue.length > 0) {
    const item = queue.shift()
    if (!item) break
    const [current, path] = item
    if (path.length > maxHops) continue

    const nextEdges = candidateEdges.filter((e) => e.from === current)
    for (const edge of nextEdges) {
      const next = edge.to
      if (!next) continue
      const nextPath = [...path, next]

      if (next === toId) {
        return nextPath
      }

      if (!visited.has(next)) {
        visited.add(next)
        queue.push([next, nextPath])
      }
    }
  }

  return null
}
