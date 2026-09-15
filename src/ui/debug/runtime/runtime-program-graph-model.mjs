// @ts-check

import { routeCurvedEdge } from '../graph/graph-svg-primitives.mjs'

const NODE_W = 160
const NODE_H = 48
const CLUSTER_PAD = 14
const CLUSTER_HEADER_H = 26
const CLUSTER_GAP = 48
const NODE_GAP = 12
const MARGIN = 32

/**
 * Layouts a program graph into columns grouped by file clusters.
 * Deterministic and cached purely on graph topology.
 *
 * @param {{
 *   nodes: Array<{ id: string, label: string, kind: string, fileId?: string }>,
 *   edges: Array<{ id: string, from: string, to: string, kind: string, label?: string }>,
 *   files: Array<{ id: string, name: string }>,
 * }} graph
 */
export function layoutRuntimeProgramGraph(graph) {
  const nodes = graph.nodes || []
  const edges = graph.edges || []
  const files = graph.files || []

  // Group nodes by file
  const nodesByFile = new Map()
  for (const f of files) {
    nodesByFile.set(f.id, [])
  }
  for (const n of nodes) {
    const fId = n.fileId || 'unknown'
    const list = nodesByFile.get(fId) || []
    list.push(n)
    nodesByFile.set(fId, list)
  }

  const layoutNodes = []
  const layoutClusters = []
  let cursorX = MARGIN
  let maxBottom = MARGIN

  for (const [fileId, fileNodes] of nodesByFile.entries()) {
    if (!fileNodes.length) continue

    const clusterW = NODE_W + CLUSTER_PAD * 2
    const nodesH = fileNodes.length * NODE_H + Math.max(0, fileNodes.length - 1) * NODE_GAP
    const clusterH = CLUSTER_HEADER_H + CLUSTER_PAD + nodesH + CLUSTER_PAD
    const clusterY = MARGIN

    const fileMeta = files.find((f) => f.id === fileId)
    const label = fileMeta?.name || fileId.replace(/^file:/, '')

    layoutClusters.push({
      id: fileId,
      label,
      x: cursorX,
      y: clusterY,
      w: clusterW,
      h: clusterH,
      headerH: CLUSTER_HEADER_H,
    })

    let nodeY = clusterY + CLUSTER_HEADER_H + CLUSTER_PAD
    for (const node of fileNodes) {
      layoutNodes.push({
        ...node,
        x: cursorX + CLUSTER_PAD,
        y: nodeY,
        w: NODE_W,
        h: NODE_H,
        cx: cursorX + CLUSTER_PAD + NODE_W / 2,
        cy: nodeY + NODE_H / 2,
      })
      nodeY += NODE_H + NODE_GAP
    }

    maxBottom = Math.max(maxBottom, clusterY + clusterH)
    cursorX += clusterW + CLUSTER_GAP
  }

  const placed = new Map(layoutNodes.map((n) => [n.id, n]))
  const layoutEdges = []
  for (const edge of edges) {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (!from || !to) continue
    layoutEdges.push({
      ...edge,
      points: routeCurvedEdge(from, to),
    })
  }

  const width = Math.max(400, cursorX + MARGIN)
  const height = Math.max(300, maxBottom + MARGIN)

  return {
    nodes: layoutNodes,
    edges: layoutEdges,
    clusters: layoutClusters,
    width,
    height,
  }
}

/**
 * Converts a canonical ProgramModel into graph nodes, edges and clusters.
 *
 * @param {import('../../../types/program.d.ts').ProgramModel} model
 * @param {{ showDataEdges?: boolean }} [options]
 */
export function buildGraphFromProgramModel(model, options = {}) {
  const showData = options.showDataEdges !== false

  /** @type {Array<{ id: string, label: string, kind: string, fileId?: string, detail?: string }>} */
  const nodes = []
  /** @type {Array<{ id: string, from: string, to: string, kind: string, label?: string }>} */
  const edges = []

  // Function nodes
  for (const fn of model.functions || []) {
    nodes.push({
      id: fn.id,
      label: fn.name,
      kind: 'function',
      fileId: fn.fileId,
      detail: `Line ${fn.line}${fn.isStatic ? ' (static)' : ''}`,
    })
  }

  // Variable nodes (if data edges enabled)
  if (showData) {
    for (const v of model.variables || []) {
      nodes.push({
        id: v.id,
        label: v.name,
        kind: 'variable',
        fileId: v.fileId || 'global',
        detail: v.type || (v.isStatic ? 'static' : 'global'),
      })
    }
  }

  // Call edges
  for (const call of model.callEdges || []) {
    if (call.callerId && call.calleeId) {
      edges.push({
        id: call.id,
        from: call.callerId,
        to: call.calleeId,
        kind: 'call',
        label: 'calls',
      })
    }
  }

  // Data edges (reads and writes)
  if (showData) {
    for (const edge of model.writeEdges || []) {
      if (edge.accessorId && edge.variableId) {
        edges.push({
          id: edge.id,
          from: edge.accessorId,
          to: edge.variableId,
          kind: 'write',
          label: 'writes',
        })
      }
    }
    for (const edge of model.readEdges || []) {
      if (edge.accessorId && edge.variableId) {
        edges.push({
          id: edge.id,
          from: edge.variableId,
          to: edge.accessorId,
          kind: 'read',
          label: 'reads',
        })
      }
    }
  }

  return {
    nodes,
    edges,
    files: model.files || [],
  }
}
