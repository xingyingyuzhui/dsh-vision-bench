import { DEMO_CALL_GRAPH_NODES } from '../fixtures/temperature-demo.mjs'
import { fileKind, filePassesFilter, fileTreeId, findProjectFile } from './project-tree-model.mjs'

export { DEMO_CALL_GRAPH_NODES, DEMO_PROJECT_MAP, DEMO_SOURCE_FILES } from '../fixtures/temperature-demo.mjs'

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

/** @param {string} selectedId @param {{ edges: { id: string, from: string, to: string }[], kind?: string }} graph */
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
  if (graph.kind === 'call') {
    let changed = true
    while (changed) {
      changed = false
      for (const edge of graph.edges) {
        if (nodeIds.has(edge.to) && !edgeIds.has(edge.id)) {
          edgeIds.add(edge.id)
          nodeIds.add(edge.from)
          changed = true
        }
      }
    }
  }
  return { edgeIds, nodeIds }
}

/**
 * Builds a function call DAG graph.
 * @param {any[]} [groups]
 * @param {{ search?: string, depth?: string }} [opts]
 */
export function buildFunctionCallGraph(groups = [], opts = {}) {
  const depthStr = opts.depth || '2'
  const needle = String(opts.search || '').trim().toLowerCase()
  const allNodes = DEMO_CALL_GRAPH_NODES.map((n) => ({ ...n, callees: n.callees.map((c) => ({ ...c })) }))
  const maxAllowedDepth = depthStr === '1' ? 1 : depthStr === '2' ? 2 : 3
  const depthById = {
    'fn:main': 0, 'fn:UpdateTemperature': 1, 'fn:UpdateDisplay': 1, 'fn:ReadTemperature': 2, 'fn:DrawText': 2, 'fn:ReadVoltage': 3,
  }

  let nodes = allNodes.filter((n) => (depthById[n.id] ?? 0) <= maxAllowedDepth)
  for (const n of nodes) {
    if (n.id === 'fn:ReadTemperature') {
      const exp = maxAllowedDepth >= 3
      n.canExpand = !exp
      n.expandBadge = exp ? '' : '+1 可展开'
      if (n.callees[0]) {
        n.callees[0].expanded = exp
        n.callees[0].location = exp ? 'sensor.c:1' : '当前层级未展开'
      }
    }
  }

  if (needle) {
    nodes = nodes.filter((n) =>
      n.label.toLowerCase().includes(needle) ||
      (n.location && n.location.toLowerCase().includes(needle)) ||
      (n.file && n.file.toLowerCase().includes(needle))
    )
  }

  const nodeSet = new Set(nodes.map((n) => n.id))
  const rawEdges = [
    ['fn:main', 'fn:UpdateTemperature'],
    ['fn:main', 'fn:UpdateDisplay'],
    ['fn:UpdateTemperature', 'fn:ReadTemperature'],
    ['fn:UpdateDisplay', 'fn:DrawText'],
    ['fn:ReadTemperature', 'fn:ReadVoltage'],
  ]

  const edges = []
  for (const [from, to] of rawEdges) {
    if (nodeSet.has(from) && nodeSet.has(to)) {
      edges.push({ id: `e:${from}:${to}:${edges.length}`, from, to, resolved: true })
    }
  }

  const depthNote = depthStr === 'all' ? '全部层级调用' : `main的${depthStr}层调用`

  return {
    kind: 'call',
    focus: 'main',
    nodes,
    edges,
    clusters: [],
    maxEdges: 100,
    maxNodes: 100,
    capped: false,
    edgesCapped: false,
    nodesCapped: false,
    orphanEdges: 0,
    scopeNote: `当前范围: ${depthNote}`,
  }
}
