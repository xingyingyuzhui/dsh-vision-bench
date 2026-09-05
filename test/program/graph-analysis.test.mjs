import assert from 'node:assert/strict'
import test from 'node:test'
import { findCausalPath, findDownstream, findUpstream } from '../../src/domain/program/graph-analysis.mjs'
import { createProgramModel } from '../../src/domain/program/program-model.mjs'

test('graph-analysis: findUpstream, findDownstream, and findCausalPath traverse call and data edges', () => {
  const model = createProgramModel({
    functions: [
      { id: 'fn:A', fileId: 'file:test.c', name: 'A', line: 10 },
      { id: 'fn:B', fileId: 'file:test.c', name: 'B', line: 20 },
      { id: 'fn:C', fileId: 'file:test.c', name: 'C', line: 30 },
    ],
    variables: [{ id: 'var:global:x', name: 'x', scope: 'global' }],
    callEdges: [
      {
        id: 'call:A->B',
        callerId: 'fn:A',
        calleeId: 'fn:B',
        calleeName: 'B',
        confidence: 'exact',
        location: { file: 'test.c', line: 12 },
      },
      {
        id: 'call:B->C',
        callerId: 'fn:B',
        calleeId: 'fn:C',
        calleeName: 'C',
        confidence: 'exact',
        location: { file: 'test.c', line: 22 },
      },
    ],
    writeEdges: [
      {
        id: 'write:C->x',
        kind: 'write',
        accessorId: 'fn:C',
        variableId: 'var:global:x',
        variableName: 'x',
        confidence: 'exact',
        location: { file: 'test.c', line: 32 },
      },
    ],
  })

  // Downstream of fn:A includes fn:B, fn:C, and var:global:x
  const down = findDownstream(model, 'fn:A')
  assert.ok(down.nodeIds.includes('fn:A'))
  assert.ok(down.nodeIds.includes('fn:B'))
  assert.ok(down.nodeIds.includes('fn:C'))
  assert.ok(down.nodeIds.includes('var:global:x'))

  // Upstream of var:global:x includes fn:C, fn:B, fn:A
  const up = findUpstream(model, 'var:global:x')
  assert.ok(up.nodeIds.includes('var:global:x'))
  assert.ok(up.nodeIds.includes('fn:C'))
  assert.ok(up.nodeIds.includes('fn:B'))
  assert.ok(up.nodeIds.includes('fn:A'))

  // Causal path from fn:A to var:global:x
  const path = findCausalPath(model, 'fn:A', 'var:global:x')
  assert.deepEqual(path, ['fn:A', 'fn:B', 'fn:C', 'var:global:x'])
})
