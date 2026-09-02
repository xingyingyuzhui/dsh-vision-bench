import { fileKind, filePassesFilter, fileTreeId, findProjectFile } from './project-tree-model.mjs'

const DEFAULT_MAX_NODES = 200
const DEFAULT_MAX_EDGES = 120

function basenameOf(path) {
  const parts = String(path || '')
    .replace(/\\/g, '/')
    .split('/')
    .filter(Boolean)
  return parts.length ? parts[parts.length - 1] : ''
}

/**
 * @param {unknown[]} groups
 * @param {unknown[]} includeEdges
 * @param {{ maxNodes?: number, maxEdges?: number, filter?: string, search?: string, backendTruncated?: boolean }} [opts]
 */
export function buildProjectGraph(groups, includeEdges, opts = {}) {
  const maxNodes = Number(opts.maxNodes) > 0 ? Number(opts.maxNodes) : DEFAULT_MAX_NODES
  const maxEdges = Number(opts.maxEdges) > 0 ? Number(opts.maxEdges) : DEFAULT_MAX_EDGES
  const filter = opts.filter || 'all'
  const needle = String(opts.search || '')
    .trim()
    .toLowerCase()
  const backendTruncated = !!opts.backendTruncated

  const nodes = []
  const clusters = []
  let nodesCapped = false

  for (const group of Array.isArray(groups) ? groups : []) {
    const clusterId = `cluster:${String(group.name || '')}`
    const nodeIds = []
    const rawFiles = Array.isArray(group.files) ? group.files : []

    for (const file of rawFiles) {
      if (nodes.length >= maxNodes) {
        nodesCapped = true
        break
      }
      if (!filePassesFilter(file, filter)) continue
      const id = fileTreeId(file)
      const label = String(file.name || basenameOf(id))
      const hay = `${label} ${id}`.toLowerCase()
      if (needle) {
        const fnHit = (file.functions || []).some((fn) =>
          String(fn?.name || '')
            .toLowerCase()
            .includes(needle),
        )
        if (!hay.includes(needle) && !fnHit) continue
      }

      const node = {
        id,
        label,
        rel: id,
        groupId: clusterId,
        groupName: String(group.name || ''),
        kind: fileKind(file),
      }
      nodes.push(node)
      nodeIds.push(id)
    }

    if (nodeIds.length) {
      clusters.push({ id: clusterId, label: String(group.name || ''), nodeIds })
    }
    if (nodesCapped) break
  }

  const nodeSet = new Set(nodes.map((n) => n.id))
  const edges = []
  let edgesCapped = false
  let unresolvedEdgeCount = 0
  let filteredEdgeCount = 0
  let cappedEdgeCount = 0
  const inputEdges = Array.isArray(includeEdges) ? includeEdges : []
  const inputEdgeCount = inputEdges.length

  for (const raw of inputEdges) {
    if (edges.length >= maxEdges) {
      edgesCapped = true
      cappedEdgeCount += 1
      continue
    }
    const fromHit = findProjectFile(groups, raw?.from)
    const toHit = findProjectFile(groups, raw?.to || raw?.name)
    const from = fromHit ? fileTreeId(fromHit.file) : ''
    const to = toHit ? fileTreeId(toHit.file) : ''
    if (!from || !to) {
      unresolvedEdgeCount += 1
      continue
    }
    if (!nodeSet.has(from) || !nodeSet.has(to)) {
      filteredEdgeCount += 1
      continue
    }
    edges.push({
      id: `e:${from}:${to}:${edges.length}`,
      from,
      to,
      resolved: raw?.resolved !== false,
    })
  }

  const renderedEdgeCount = edges.length
  const orphanEdges = unresolvedEdgeCount + filteredEdgeCount

  return {
    nodes,
    edges,
    clusters,
    maxEdges,
    maxNodes,
    capped: nodesCapped || edgesCapped,
    edgesCapped,
    nodesCapped,
    orphanEdges,
    truncation: {
      inputEdgeCount,
      renderedEdgeCount,
      unresolvedEdgeCount,
      filteredEdgeCount,
      cappedEdgeCount,
      backendTruncated,
    },
  }
}

/** @param {string} selectedId @param {{ edges: { id: string, from: string, to: string }[] }} graph */
export function graphNeighborhood(selectedId, graph) {
  const id = String(selectedId || '')
  if (!id || !graph?.edges?.length) return { edgeIds: new Set(), nodeIds: new Set() }
  const edgeIds = new Set()
  const nodeIds = new Set([id])
  for (const edge of graph.edges) {
    if (edge.from === id || edge.to === id) {
      edgeIds.add(edge.id)
      nodeIds.add(edge.from)
      nodeIds.add(edge.to)
    }
  }
  return { edgeIds, nodeIds }
}
