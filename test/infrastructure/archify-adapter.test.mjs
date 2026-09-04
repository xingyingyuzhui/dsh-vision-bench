import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgramModel } from '../../src/domain/program/program-model.mjs'
import {
  debugStoryToArchify,
  findCausalPath,
  findDownstream,
  findUpstream,
  programDeltaToArchify,
  programModelToArchify,
} from '../../src/infrastructure/archify/archify-adapter.mjs'

test('archify-adapter: programModelToArchify converts canonical model to Archify IR', () => {
  const model = createProgramModel({
    project: 'stm32_app.uvprojx',
    target: 'Release',
    files: [
      { id: 'file:main.c', name: 'main.c', rel: 'main.c', kind: 'c', inside: true, exists: true, readable: true },
    ],
    functions: [
      { id: 'fn:main.c:main:10', fileId: 'file:main.c', name: 'main', line: 10 },
      { id: 'fn:main.c:init:20', fileId: 'file:main.c', name: 'init', line: 20 },
    ],
    variables: [{ id: 'var:global:target', name: 'target', scope: 'global', type: 'uint32_t' }],
    callEdges: [
      {
        id: 'call:1',
        callerId: 'fn:main.c:main:10',
        calleeId: 'fn:main.c:init:20',
        calleeName: 'init',
        confidence: 'exact',
        location: { file: 'main.c', line: 12 },
      },
    ],
    writeEdges: [
      {
        id: 'write:1',
        kind: 'write',
        accessorId: 'fn:main.c:init:20',
        variableId: 'var:global:target',
        variableName: 'target',
        confidence: 'exact',
        location: { file: 'main.c', line: 22 },
      },
    ],
  })

  const ir = programModelToArchify(model)
  assert.equal(ir.version, '1.0.0')
  assert.equal(ir.metadata.project, 'stm32_app.uvprojx')

  // Nodes should include file, functions, and variable
  assert.ok(ir.nodes.some((n) => n.id === 'file:main.c' && n.kind === 'file'))
  assert.ok(ir.nodes.some((n) => n.id === 'fn:main.c:main:10' && n.kind === 'function'))
  assert.ok(ir.nodes.some((n) => n.id === 'var:global:target' && n.kind === 'variable'))

  // Groups
  assert.ok(ir.groups.some((g) => g.id === 'group:file:main.c'))

  // Edges
  assert.ok(ir.edges.some((e) => e.kind === 'call' && e.from === 'fn:main.c:main:10'))
  assert.ok(ir.edges.some((e) => e.kind === 'write' && e.to === 'var:global:target'))
})

test('archify-adapter: findUpstream, findDownstream, and findCausalPath graph traversal', () => {
  const model = createProgramModel({
    functions: [
      { id: 'fn:sensor', fileId: 'file:main.c', name: 'ReadSensor', line: 10 },
      { id: 'fn:calc', fileId: 'file:main.c', name: 'CalculateSuperheat', line: 20 },
      { id: 'fn:protect', fileId: 'file:main.c', name: 'LowLoad_Protect', line: 30 },
    ],
    variables: [{ id: 'var:eev', name: 'eev_target', scope: 'global' }],
    callEdges: [
      {
        id: 'c1',
        callerId: 'fn:sensor',
        calleeId: 'fn:calc',
        calleeName: 'calc',
        confidence: 'exact',
        location: { file: 'main.c', line: 15 },
      },
      {
        id: 'c2',
        callerId: 'fn:calc',
        calleeId: 'fn:protect',
        calleeName: 'protect',
        confidence: 'exact',
        location: { file: 'main.c', line: 25 },
      },
    ],
    writeEdges: [
      {
        id: 'w1',
        kind: 'write',
        accessorId: 'fn:protect',
        variableId: 'var:eev',
        variableName: 'eev_target',
        confidence: 'exact',
        location: { file: 'main.c', line: 35 },
      },
    ],
  })

  // 1. Upstream of var:eev -> should find protect, calc, sensor
  const upstream = findUpstream(model, 'var:eev')
  assert.ok(upstream.nodeIds.includes('var:eev'))
  assert.ok(upstream.nodeIds.includes('fn:protect'))
  assert.ok(upstream.nodeIds.includes('fn:calc'))
  assert.ok(upstream.nodeIds.includes('fn:sensor'))
  assert.ok(upstream.paths.length >= 1)

  // 2. Downstream of fn:sensor -> should find calc, protect, var:eev
  const downstream = findDownstream(model, 'fn:sensor')
  assert.ok(downstream.nodeIds.includes('fn:sensor'))
  assert.ok(downstream.nodeIds.includes('fn:calc'))
  assert.ok(downstream.nodeIds.includes('fn:protect'))
  assert.ok(downstream.nodeIds.includes('var:eev'))

  // 3. Causal path from fn:sensor to var:eev
  const path = findCausalPath(model, 'fn:sensor', 'var:eev')
  assert.deepEqual(path, ['fn:sensor', 'fn:calc', 'fn:protect', 'var:eev'])

  // 4. Unconnected node returns null
  const unreachable = findCausalPath(model, 'var:eev', 'fn:sensor')
  assert.equal(unreachable, null)
})

test('archify-adapter: debugStoryToArchify synthesizes chronological narrative and summary', () => {
  const events = [
    {
      id: 'e1',
      cursor: 1,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 1000,
      type: 'session-started',
      backend: /** @type {const} */ ('gdb-openocd'),
    },
    {
      id: 'e2',
      cursor: 2,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 2000,
      type: 'target-paused',
      backend: /** @type {const} */ ('gdb-openocd'),
      payload: {
        reason: 'watchpoint-hit',
        watchpointExpression: 'eev_target',
        location: { file: 'Core/Src/control.c', line: 45 },
      },
    },
    {
      id: 'e3',
      cursor: 3,
      debugSessionId: 's1',
      workspaceCwd: '/ws',
      ownerSessionId: 'o1',
      timestamp: 2100,
      type: 'snapshot-created',
      backend: /** @type {const} */ ('gdb-openocd'),
      payload: {
        snapshotId: 'snap-123',
        reason: 'watchpoint-hit',
      },
    },
  ]

  const snapshots = [
    {
      id: 'snap-123',
      createdAt: 2100,
      reason: 'watchpoint-hit',
      location: { file: 'Core/Src/control.c', line: 45 },
      backend: /** @type {const} */ ('gdb-openocd'),
    },
  ]

  const story = debugStoryToArchify(events, snapshots, {
    title: 'EEV Unexpected Zero Story',
    rootCause: 'LowLoad condition triggered due to superheat sensor drift',
  })

  assert.equal(story.title, 'EEV Unexpected Zero Story')
  assert.equal(story.steps.length, 3)
  assert.equal(story.summary.totalSteps, 3)
  assert.equal(story.summary.stoppedReason, 'watchpoint-hit')
  assert.equal(story.summary.durationMs, 1100)
  assert.ok(story.narrative.includes('步骤 1'))
  assert.ok(story.narrative.includes('步骤 2'))
  assert.ok(story.narrative.includes('根本原因分析'))
})

test('archify-adapter: programDeltaToArchify calculates added, removed, and modified elements', () => {
  const beforeModel = createProgramModel({
    functions: [
      { id: 'fn:a', name: 'funcA', fileId: 'file:main.c', line: 10, endLine: 20 },
      { id: 'fn:b', name: 'funcB', fileId: 'file:main.c', line: 30, endLine: 40 },
    ],
    variables: [{ id: 'var:x', name: 'varX', scope: 'global' }],
    callEdges: [
      {
        id: 'c1',
        callerId: 'fn:a',
        calleeId: 'fn:b',
        calleeName: 'funcB',
        confidence: 'exact',
        location: { file: 'main.c', line: 15 },
      },
    ],
  })

  const afterModel = createProgramModel({
    functions: [
      { id: 'fn:a', name: 'funcA', fileId: 'file:main.c', line: 12, endLine: 22 }, // modified line
      { id: 'fn:c', name: 'funcC', fileId: 'file:main.c', line: 50, endLine: 60 }, // added (funcB removed)
    ],
    variables: [
      { id: 'var:x', name: 'varX', scope: 'global' },
      { id: 'var:y', name: 'varY', scope: 'global' }, // added
    ],
    callEdges: [
      {
        id: 'c2',
        callerId: 'fn:a',
        calleeId: 'fn:c',
        calleeName: 'funcC',
        confidence: 'exact',
        location: { file: 'main.c', line: 16 },
      },
    ],
  })

  const delta = programDeltaToArchify(beforeModel, afterModel)

  assert.equal(delta.addedFunctions.length, 1)
  assert.equal(delta.addedFunctions[0].name, 'funcC')

  assert.equal(delta.removedFunctions.length, 1)
  assert.equal(delta.removedFunctions[0].name, 'funcB')

  assert.equal(delta.modifiedFunctions.length, 1)
  assert.equal(delta.modifiedFunctions[0].name, 'funcA')
  assert.equal(delta.modifiedFunctions[0].changes.newLine, 12)

  assert.equal(delta.addedVariables.length, 1)
  assert.equal(delta.addedVariables[0].name, 'varY')
  assert.equal(delta.removedVariables.length, 0)

  assert.equal(delta.addedCalls.length, 1)
  assert.equal(delta.removedCalls.length, 1)

  assert.equal(delta.summary.functionsDelta, 0) // +1 -1 = 0
  assert.equal(delta.summary.variablesDelta, 1) // +1
})
