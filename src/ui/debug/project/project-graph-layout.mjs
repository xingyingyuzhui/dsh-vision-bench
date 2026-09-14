import { cubicEdgePath } from '../graph/graph-svg-primitives.mjs'

// Card geometry follows the reference design: a wide two-line card with room
// for a leading icon tile, a title and a subtitle.
const NODE_W = 188
const NODE_H = 58
const CLUSTER_PAD = 14
export const CLUSTER_HEADER_H = 28
const CLUSTER_GAP = 56
const FILE_GAP = 12
const MARGIN = 36

const placedNode = (n, x, y) => ({ ...n, x, y, w: NODE_W, h: NODE_H, cx: x + NODE_W / 2, cy: y + NODE_H / 2 })

/**
 * @param {{ kind?: string, nodes: { id: string, label?: string }[], edges: { id: string, from: string, to: string, resolved?: boolean }[], clusters?: { id: string, label: string, nodeIds: string[] }[] }} graph
 */
export function layoutProjectGraph(graph) {
  if (graph.kind === 'call' || (!graph.clusters || !graph.clusters.length)) {
    const nodes = graph.nodes || []
    const edges = graph.edges || []
    const incoming = new Map(nodes.map((n) => [n.id, []]))
    const outgoing = new Map(nodes.map((n) => [n.id, []]))
    for (const e of edges) {
      outgoing.get(e.from)?.push(e.to)
      incoming.get(e.to)?.push(e.from)
    }

    const depthMap = new Map()
    const roots = nodes.filter((n) => (incoming.get(n.id) || []).length === 0 || n.label === 'main')
    if (!roots.length && nodes.length) roots.push(nodes[0])

    const queue = roots.map((r) => ({ id: r.id, depth: 0 }))
    for (const r of roots) depthMap.set(r.id, 0)

    while (queue.length > 0) {
      const { id, depth } = queue.shift()
      for (const nextId of outgoing.get(id) || []) {
        if (!depthMap.has(nextId) || depthMap.get(nextId) < depth + 1) {
          depthMap.set(nextId, depth + 1)
          queue.push({ id: nextId, depth: depth + 1 })
        }
      }
    }

    for (const n of nodes) {
      if (!depthMap.has(n.id)) depthMap.set(n.id, 0)
    }

    const maxDepth = Math.max(0, ...Array.from(depthMap.values()))
    const layers = Array.from({ length: maxDepth + 1 }, () => [])
    for (const n of nodes) {
      layers[depthMap.get(n.id)].push(n)
    }

    const maxLayerCount = Math.max(1, ...layers.map((l) => l.length))
    const totalHeight = Math.max(340, maxLayerCount * NODE_H + (maxLayerCount - 1) * 32 + MARGIN * 2)

    const layoutNodes = []
    const layerGap = 90
    layers.forEach((layerNodes, layerIdx) => {
      const x = MARGIN + layerIdx * (NODE_W + layerGap)
      const count = layerNodes.length
      const layerH = count * NODE_H + (count - 1) * 24
      let y = Math.max(MARGIN, (totalHeight - layerH) / 2)

      for (const node of layerNodes) {
        layoutNodes.push(placedNode(node, x, y))
        y += NODE_H + 24
      }
    })

    const placed = new Map(layoutNodes.map((n) => [n.id, n]))
    const layoutEdges = routeEdges(edges, placed)

    const width = Math.max(480, MARGIN + (maxDepth + 1) * (NODE_W + layerGap) + MARGIN)
    const height = Math.max(340, totalHeight)
    return { nodes: layoutNodes, edges: layoutEdges, clusters: [], width, height }
  }

  const nodeById = new Map((graph.nodes || []).map((n) => [n.id, n]))
  const layoutNodes = []
  const layoutClusters = []
  let cursorX = MARGIN
  let maxBottom = MARGIN

  for (const cluster of graph.clusters || []) {
    const members = (cluster.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean)
    if (!members.length) continue
    const clusterW = NODE_W + CLUSTER_PAD * 2
    const clusterH = CLUSTER_HEADER_H + members.length * NODE_H + (members.length - 1) * FILE_GAP + CLUSTER_PAD
    const clusterY = MARGIN

    layoutClusters.push({
      id: cluster.id,
      label: cluster.label,
      x: cursorX,
      y: clusterY,
      w: clusterW,
      h: clusterH,
      headerH: CLUSTER_HEADER_H,
    })

    let fileY = clusterY + CLUSTER_HEADER_H
    for (const node of members) {
      layoutNodes.push(placedNode(node, cursorX + CLUSTER_PAD, fileY))
      fileY += NODE_H + FILE_GAP
    }

    maxBottom = Math.max(maxBottom, clusterY + clusterH)
    cursorX += clusterW + CLUSTER_GAP
  }

  const placed = new Map(layoutNodes.map((n) => [n.id, n]))
  const layoutEdges = routeEdges(graph.edges, placed)

  const width = Math.max(320, cursorX + MARGIN)
  const height = Math.max(240, maxBottom + MARGIN)
  return { nodes: layoutNodes, edges: layoutEdges, clusters: layoutClusters, width, height }
}

function routeEdges(edges, placed) {
  const out = []
  for (const edge of edges || []) {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (!from || !to) continue
    out.push({
      ...edge,
      points: routeEdge(from, to),
      d: cubicEdgePath(from, to),
    })
  }
  return out
}

function routeEdge(from, to) {
  const x1 = from.x + from.w
  const y1 = from.cy
  const x2 = to.x
  const y2 = to.cy
  const bend = Math.min(72, Math.max(24, Math.abs(x2 - x1) * 0.35))
  return [
    [x1, y1],
    [x1 + bend, y1],
    [x2 - bend, y2],
    [x2, y2],
  ]
}

export { polylinePath, cubicEdgePath } from '../graph/graph-svg-primitives.mjs'
export { fitViewTransform, focusNodeTransform, isUsableViewport, zoomAround } from '../graph/graph-camera.mjs'
