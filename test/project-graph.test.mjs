import assert from 'node:assert/strict'
import test from 'node:test'
import { buildProjectGraph, graphNeighborhood } from '../src/ui/debug/project/project-graph-model.mjs'
import { fitViewTransform, focusNodeTransform, layoutProjectGraph, polylinePath } from '../src/ui/debug/project/project-graph-layout.mjs'

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
