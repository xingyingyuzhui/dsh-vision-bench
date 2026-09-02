import assert from 'node:assert/strict'
import test from 'node:test'
import {
  CLUSTER_HEADER_H,
  fitViewTransform,
  focusNodeTransform,
  layoutProjectGraph,
  polylinePath,
} from '../src/ui/debug/project/project-graph-layout.mjs'
import { buildProjectGraph, graphNeighborhood } from '../src/ui/debug/project/project-graph-model.mjs'

const GROUPS = [
  {
    name: 'Source',
    files: [
      { name: 'main.c', rel: 'src/main.c', inside: true, exists: true, readable: true, functions: [] },
      { name: 'util.c', rel: 'src/util.c', inside: true, exists: true, readable: true, functions: [] },
    ],
  },
  {
    name: 'Drivers',
    files: [{ name: 'uart.c', rel: 'drv/uart.c', inside: true, exists: true, readable: true, functions: [] }],
  },
]

test('buildProjectGraph maps groups to nodes and resolves include edges', () => {
  const graph = buildProjectGraph(GROUPS, [
    { from: 'main.c', to: 'uart.h', resolved: false },
    { from: 'main.c', to: 'util.c', resolved: true },
  ])
  assert.equal(graph.nodes.length, 3)
  assert.equal(graph.clusters.length, 2)
  assert.equal(graph.edges.length, 1)
  assert.equal(graph.edges[0].from, 'src/main.c')
  assert.equal(graph.edges[0].to, 'src/util.c')
  assert.equal(graph.orphanEdges, 1)
  assert.equal(graph.truncation.inputEdgeCount, 2)
  assert.equal(graph.truncation.renderedEdgeCount, 1)
  assert.equal(graph.truncation.unresolvedEdgeCount, 1)
  assert.equal(graph.truncation.filteredEdgeCount, 0)
  assert.equal(graph.truncation.cappedEdgeCount, 0)
  assert.equal(graph.truncation.backendTruncated, false)
})

test('buildProjectGraph reports edge cap and filter stats', () => {
  const manyEdges = Array.from({ length: 5 }, (_, i) => ({
    from: 'main.c',
    to: 'util.c',
    resolved: true,
    tag: i,
  }))
  const capped = buildProjectGraph(GROUPS, manyEdges, { maxEdges: 2 })
  assert.equal(capped.edges.length, 2)
  assert.equal(capped.truncation.cappedEdgeCount, 3)
  assert.equal(capped.truncation.inputEdgeCount, 5)
  assert.equal(capped.maxEdges, 2)

  const filtered = buildProjectGraph(GROUPS, [{ from: 'main.c', to: 'uart.c', resolved: true }], {
    search: 'uart',
  })
  assert.equal(filtered.nodes.length, 1)
  assert.equal(filtered.edges.length, 0)
  assert.equal(filtered.truncation.filteredEdgeCount, 1)

  const backend = buildProjectGraph(GROUPS, [], { backendTruncated: true })
  assert.equal(backend.truncation.backendTruncated, true)
})

test('buildProjectGraph respects search filter', () => {
  const graph = buildProjectGraph(GROUPS, [], { search: 'uart' })
  assert.equal(graph.nodes.length, 1)
  assert.equal(graph.nodes[0].label, 'uart.c')
})

test('layoutProjectGraph places clusters and edges', () => {
  const graph = buildProjectGraph(GROUPS, [{ from: 'main.c', to: 'util.c', resolved: true }])
  const layout = layoutProjectGraph(graph)
  assert.ok(layout.width > 200)
  assert.equal(layout.nodes.length, 3)
  assert.equal(layout.edges.length, 1)
  assert.match(polylinePath(layout.edges[0].points), /^M/)
  const fit = fitViewTransform(layout, 400, 300)
  assert.ok(fit.scale > 0)
})

test('layoutProjectGraph reserves cluster header space above nodes', () => {
  assert.equal(CLUSTER_HEADER_H, 28)
  const graph = buildProjectGraph(GROUPS, [])
  const layout = layoutProjectGraph(graph)
  const sourceCluster = layout.clusters.find((c) => c.label === 'Source')
  assert.ok(sourceCluster, 'Source cluster present')
  const sourceNodes = layout.nodes.filter((n) => n.groupName === 'Source')
  assert.ok(sourceNodes.length >= 2)
  for (const node of sourceNodes) {
    assert.ok(node.y >= sourceCluster.y + CLUSTER_HEADER_H, `node ${node.label} must sit below cluster header`)
  }
})

test('focusNodeTransform centers on a node', () => {
  const graph = buildProjectGraph(GROUPS, [{ from: 'main.c', to: 'util.c', resolved: true }])
  const layout = layoutProjectGraph(graph)
  const focus = focusNodeTransform(layout, 'src/main.c', 400, 300)
  assert.ok(focus.scale > 0)
  assert.ok(Math.abs(focus.panX) < 2000)
})

test('graphNeighborhood highlights one-hop edges', () => {
  const graph = buildProjectGraph(GROUPS, [{ from: 'main.c', to: 'util.c', resolved: true }])
  const hood = graphNeighborhood('src/main.c', graph)
  assert.ok(hood.edgeIds.size >= 1)
  assert.ok(hood.nodeIds.has('src/util.c'))
})
