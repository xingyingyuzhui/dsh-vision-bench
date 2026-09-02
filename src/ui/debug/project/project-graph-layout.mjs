const NODE_W = 152
const NODE_H = 46
const CLUSTER_PAD = 14
export const CLUSTER_HEADER_H = 28
const CLUSTER_GAP = 56
const FILE_GAP = 10
const MARGIN = 36

/**
 * @param {{ nodes: { id: string }[], edges: { id: string, from: string, to: string, resolved?: boolean }[], clusters: { id: string, label: string, nodeIds: string[] }[] }} graph
 */
export function layoutProjectGraph(graph) {
  const nodeById = new Map((graph.nodes || []).map((n) => [n.id, n]))
  const layoutNodes = []
  const layoutClusters = []
  let cursorX = MARGIN
  let maxBottom = MARGIN

  for (const cluster of graph.clusters || []) {
    const members = (cluster.nodeIds || []).map((id) => nodeById.get(id)).filter(Boolean)
    if (!members.length) continue
    const clusterW = NODE_W + CLUSTER_PAD * 2
    const nodesH = members.length * NODE_H + Math.max(0, members.length - 1) * FILE_GAP
    const clusterH = CLUSTER_HEADER_H + CLUSTER_PAD + nodesH + CLUSTER_PAD
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
      layoutNodes.push({
        ...node,
        x: cursorX + CLUSTER_PAD,
        y: fileY,
        w: NODE_W,
        h: NODE_H,
        cx: cursorX + CLUSTER_PAD + NODE_W / 2,
        cy: fileY + NODE_H / 2,
      })
      fileY += NODE_H + FILE_GAP
    }

    maxBottom = Math.max(maxBottom, clusterY + clusterH)
    cursorX += clusterW + CLUSTER_GAP
  }

  const placed = new Map(layoutNodes.map((n) => [n.id, n]))
  const layoutEdges = []
  for (const edge of graph.edges || []) {
    const from = placed.get(edge.from)
    const to = placed.get(edge.to)
    if (!from || !to) continue
    layoutEdges.push({
      ...edge,
      points: routeEdge(from, to),
    })
  }

  const width = Math.max(320, cursorX + MARGIN)
  const height = Math.max(240, maxBottom + MARGIN)
  return { nodes: layoutNodes, edges: layoutEdges, clusters: layoutClusters, width, height }
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

export function polylinePath(points) {
  if (!Array.isArray(points) || points.length < 2) return ''
  return points.map((p, i) => `${i === 0 ? 'M' : 'L'}${p[0]},${p[1]}`).join(' ')
}

export function fitViewTransform(layout, viewportW, viewportH, padding = 24) {
  const w = Number(layout?.width) || 320
  const h = Number(layout?.height) || 240
  const vw = Math.max(120, Number(viewportW) || 320)
  const vh = Math.max(120, Number(viewportH) || 240)
  const scale = Math.min((vw - padding * 2) / w, (vh - padding * 2) / h, 1.4)
  const panX = (vw - w * scale) / 2
  const panY = (vh - h * scale) / 2
  return { scale, panX, panY }
}

export function focusNodeTransform(layout, nodeId, viewportW, viewportH, scale = 1.15, padding = 32) {
  const node = (layout?.nodes || []).find((n) => n.id === nodeId)
  if (!node) return fitViewTransform(layout, viewportW, viewportH, padding)
  const vw = Math.max(120, Number(viewportW) || 320)
  const vh = Math.max(120, Number(viewportH) || 240)
  const cx = node.x + node.w / 2
  const cy = node.y + node.h / 2
  const clamped = Math.min(Math.max(scale, 0.5), 2.2)
  return {
    scale: clamped,
    panX: vw / 2 - cx * clamped,
    panY: vh / 2 - cy * clamped,
  }
}
