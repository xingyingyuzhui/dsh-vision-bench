// @ts-check

/**
 * Computes 1-hop neighborhood for a selected node in a graph.
 *
 * @param {string} selectedId
 * @param {Array<{ id: string, from: string, to: string }>} edges
 * @returns {{
 *   edgeIds: Set<string>,
 *   nodeIds: Set<string>,
 *   incomingEdgeIds: Set<string>,
 *   outgoingEdgeIds: Set<string>,
 * }}
 */
export function computeNeighborhood(selectedId, edges = []) {
  const id = String(selectedId || '')
  if (!id || !edges || !edges.length) {
    return {
      edgeIds: new Set(),
      nodeIds: new Set(),
      incomingEdgeIds: new Set(),
      outgoingEdgeIds: new Set(),
    }
  }

  const edgeIds = new Set()
  const nodeIds = new Set([id])
  const incomingEdgeIds = new Set()
  const outgoingEdgeIds = new Set()

  for (const edge of edges) {
    if (edge.to === id) {
      edgeIds.add(edge.id)
      nodeIds.add(edge.from)
      incomingEdgeIds.add(edge.id)
    }
    if (edge.from === id) {
      edgeIds.add(edge.id)
      nodeIds.add(edge.to)
      outgoingEdgeIds.add(edge.id)
    }
  }

  return {
    edgeIds,
    nodeIds,
    incomingEdgeIds,
    outgoingEdgeIds,
  }
}
