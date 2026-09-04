import assert from 'node:assert/strict'
import test from 'node:test'
import React from 'react'
import { renderToString } from 'react-dom/server'
import { createProgramModel } from '../../src/domain/program/program-model.mjs'
import { clamp, fitViewTransform, focusNodeTransform } from '../../src/ui/debug/graph/graph-camera.mjs'
import { computeNeighborhood } from '../../src/ui/debug/graph/graph-focus.mjs'
import {
  polylinePath,
  renderCommonSvgMarkers,
  routeCurvedEdge,
} from '../../src/ui/debug/graph/graph-svg-primitives.mjs'
import {
  buildGraphFromProgramModel,
  createRuntimeProgramGraph,
  layoutRuntimeProgramGraph,
} from '../../src/ui/debug/runtime/runtime-program-graph.mjs'

test('graph-camera: clamp, fitViewTransform, and focusNodeTransform math', () => {
  assert.equal(clamp(5, 0, 10), 5)
  assert.equal(clamp(-5, 0, 10), 0)
  assert.equal(clamp(15, 0, 10), 10)

  const layout = { width: 800, height: 600, nodes: [{ id: 'n1', x: 100, y: 100, w: 160, h: 48 }] }
  const fit = fitViewTransform(layout, 1000, 800, 20)
  assert.ok(fit.scale > 0)
  assert.ok(typeof fit.panX === 'number')
  assert.ok(typeof fit.panY === 'number')

  const focus = focusNodeTransform(layout, 'n1', 1000, 800, 1.2)
  assert.equal(focus.scale, 1.2)
  assert.ok(typeof focus.panX === 'number')
  assert.ok(typeof focus.panY === 'number')

  // Non-existent node falls back to fit
  const focusMissing = focusNodeTransform(layout, 'missing', 1000, 800)
  assert.deepEqual(focusMissing, fitViewTransform(layout, 1000, 800, 32))
})

test('graph-svg-primitives: polylinePath, routeCurvedEdge, and markers', () => {
  const points = [
    [10, 20],
    [30, 20],
    [50, 60],
    [70, 60],
  ]
  const path = polylinePath(points)
  assert.equal(path, 'M10,20 L30,20 L50,60 L70,60')
  assert.equal(polylinePath([]), '')

  const from = { x: 10, y: 20, w: 100, h: 40, cy: 40 }
  const to = { x: 200, y: 100, w: 100, h: 40, cy: 120 }
  const routed = routeCurvedEdge(from, to)
  assert.equal(routed.length, 4)
  assert.deepEqual(routed[0], [110, 40])
  assert.deepEqual(routed[3], [200, 120])

  const defsHtml = renderToString(renderCommonSvgMarkers(React))
  assert.ok(defsHtml.includes('dvb-arrow-default'))
  assert.ok(defsHtml.includes('dvb-arrow-active'))
  assert.ok(defsHtml.includes('dvb-arrow-watchpoint'))
  assert.ok(defsHtml.includes('dvb-arrow-data-write'))
  assert.ok(defsHtml.includes('dvb-arrow-data-read'))
})

test('graph-focus: computeNeighborhood extracts 1-hop connected edges and neighbor nodes', () => {
  const edges = [
    { id: 'e1', from: 'n1', to: 'n2' },
    { id: 'e2', from: 'n2', to: 'n3' },
    { id: 'e3', from: 'n4', to: 'n2' },
  ]

  const hoodN2 = computeNeighborhood('n2', edges)
  assert.deepEqual(Array.from(hoodN2.nodeIds).sort(), ['n1', 'n2', 'n3', 'n4'])
  assert.deepEqual(Array.from(hoodN2.edgeIds).sort(), ['e1', 'e2', 'e3'])
  assert.deepEqual(Array.from(hoodN2.incomingEdgeIds).sort(), ['e1', 'e3'])
  assert.deepEqual(Array.from(hoodN2.outgoingEdgeIds).sort(), ['e2'])

  const emptyHood = computeNeighborhood('', edges)
  assert.equal(emptyHood.nodeIds.size, 0)
})

test('runtime-program-graph: buildGraphFromProgramModel and layout stability (Section 14.3)', () => {
  const model = createProgramModel({
    files: [
      {
        id: 'file:Core/Src/main.c',
        name: 'main.c',
        rel: 'Core/Src/main.c',
        kind: 'c',
        inside: true,
        exists: true,
        readable: true,
      },
      {
        id: 'file:Core/Src/pid.c',
        name: 'pid.c',
        rel: 'Core/Src/pid.c',
        kind: 'c',
        inside: true,
        exists: true,
        readable: true,
      },
    ],
    functions: [
      { id: 'fn:main', fileId: 'file:Core/Src/main.c', name: 'main', line: 15 },
      { id: 'fn:pid', fileId: 'file:Core/Src/pid.c', name: 'PID_Step', line: 20 },
    ],
    variables: [{ id: 'var:eev_target', name: 'eev_target', scope: 'global', type: 'uint32_t' }],
    callEdges: [
      {
        id: 'c1',
        callerId: 'fn:main',
        calleeId: 'fn:pid',
        calleeName: 'PID_Step',
        confidence: 'exact',
        location: { file: 'main.c', line: 18 },
      },
    ],
    writeEdges: [
      {
        id: 'w1',
        kind: 'write',
        accessorId: 'fn:pid',
        variableId: 'var:eev_target',
        variableName: 'eev_target',
        confidence: 'exact',
        location: { file: 'pid.c', line: 25 },
      },
    ],
  })

  const graphData = buildGraphFromProgramModel(model)
  assert.equal(graphData.nodes.length, 3) // 2 functions + 1 variable
  assert.equal(graphData.edges.length, 2) // 1 call + 1 write

  const layout = layoutRuntimeProgramGraph(graphData)
  assert.ok(layout.width >= 400)
  assert.ok(layout.height >= 300)
  assert.equal(layout.nodes.length, 3)
  assert.equal(layout.edges.length, 2)
  assert.ok(layout.clusters.length >= 2)

  // Verify that layout output is strictly pure and deterministic
  const layoutRepeat = layoutRuntimeProgramGraph(graphData)
  assert.deepEqual(layout, layoutRepeat)
})

test('runtime-program-graph: renders component with PC badge, stack highlight, breakpoint, and live variable values', () => {
  const RuntimeProgramGraph = createRuntimeProgramGraph(React)

  const model = createProgramModel({
    files: [
      {
        id: 'file:Core/Src/control.c',
        name: 'control.c',
        rel: 'Core/Src/control.c',
        kind: 'c',
        inside: true,
        exists: true,
        readable: true,
      },
    ],
    functions: [
      { id: 'fn:1', fileId: 'file:Core/Src/control.c', name: 'PID_Step', line: 10 },
      { id: 'fn:2', fileId: 'file:Core/Src/control.c', name: 'LowLoad_Protect', line: 30 },
    ],
    variables: [
      { id: 'var:1', fileId: 'file:Core/Src/control.c', name: 'eev_target', scope: 'global', type: 'uint32_t' },
    ],
    callEdges: [
      {
        id: 'call:1',
        callerId: 'fn:1',
        calleeId: 'fn:2',
        calleeName: 'LowLoad_Protect',
        confidence: 'exact',
        location: { file: 'control.c', line: 15 },
      },
    ],
    writeEdges: [
      {
        id: 'write:1',
        kind: 'write',
        accessorId: 'fn:2',
        variableId: 'var:1',
        variableName: 'eev_target',
        confidence: 'exact',
        location: { file: 'control.c', line: 35 },
      },
    ],
  })

  const runtimeOverlay = {
    activeFunctionId: 'fn:2', // Current PC
    activeNodeIds: ['fn:1', 'fn:2'], // Call stack
    activeEdgeIds: ['call:1'], // Active call
    breakpointNodeIds: ['fn:2'], // Breakpoint on fn:2
    watchpointHitNodeId: 'var:1', // Watchpoint hit on eev_target
    valuesByNodeId: {
      'var:1': '0', // Live value pill
    },
  }

  const html = renderToString(
    React.createElement(RuntimeProgramGraph, {
      programModel: model,
      runtimeOverlay,
      selectedId: 'fn:2',
    }),
  )

  // Verify PC badge rendered
  assert.ok(html.includes('>PC<'))
  // Verify Watchpoint WP badge rendered
  assert.ok(html.includes('>WP<'))
  // Verify function and variable labels
  assert.ok(html.includes('PID_Step'))
  assert.ok(html.includes('LowLoad_Protect'))
  assert.ok(html.includes('eev_target'))
  // Verify live value pill
  assert.ok(html.includes('eev_target = 0'))
  // Verify active styles
  assert.ok(html.includes('is-pc'))
  assert.ok(html.includes('is-stack'))
  // Verify fit button
  assert.ok(html.includes('适应视口'))
})
