// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeCSourceHeuristic,
  resolveModelReferences,
} from '../../src/infrastructure/program/heuristic-c-source-analyzer.mjs'
import { analyzeCSourceWithLezer } from '../../src/infrastructure/program/lezer-c-analyzer.mjs'

test('AST analyzer (Lezer): extracts self-recursive calls and handles prefix/compound operators', () => {
  const code = `
int factorial(int n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

void mutate(void) {
  int x = 10;
  ++x;
  x++;
  x += 5;
}
`
  const result = analyzeCSourceWithLezer(code, 'src/math.c')

  // 1. Recursive call
  const factCall = result.callEdges.find((e) => e.calleeName === 'factorial')
  assert.ok(factCall, 'Self-recursive call must not be filtered out')
  assert.equal(factCall.confidence, 'ast')

  // 2. Prefix ++x and postfix x++
  const xWrites = result.writeEdges.filter((w) => w.variableName === 'x')
  assert.ok(xWrites.length >= 3, `Expected at least 3 writes to x (++x, x++, x+=5), got ${xWrites.length}`)

  // 3. Read edges for compound/update
  const xReads = result.readEdges.filter((r) => r.variableName === 'x')
  assert.ok(xReads.length >= 1, 'Compound assignment / update must generate read edge for x')
})

test('Heuristic analyzer: extracts self-recursive calls, prefix updates, and compound reads', () => {
  const code = `
int factorial(int n) {
  if (n <= 1) return 1;
  return n * factorial(n - 1);
}

void mutate(void) {
  int x = 10;
  ++x;
  x++;
  x += 5;
}
`
  const result = analyzeCSourceHeuristic(code, 'src/math.c')

  // 1. Recursive call
  const factCall = result.callEdges.find((e) => e.calleeName === 'factorial')
  assert.ok(factCall, 'Self-recursive call must not be filtered out in heuristic analyzer')

  // 2. Prefix ++x, postfix x++, and x += 5
  const xWrites = result.writeEdges.filter((w) => w.variableName === 'x')
  assert.ok(xWrites.length >= 3, `Expected at least 3 writes to x (++x, x++, x+=5), got ${xWrites.length}`)

  // 3. Read edges
  const xReads = result.readEdges.filter((r) => r.variableName === 'x')
  assert.ok(xReads.length >= 1, 'Expected compound/update read edges for x')
})

test('resolveModelReferences: prioritizes file-local static symbols over external symbols', () => {
  /** @type {import('../../types/program.d.ts').ProgramModel} */
  const model = {
    id: 'test-model',
    workspaceCwd: '/test',
    files: [
      {
        id: 'file:src/a.c',
        path: 'src/a.c',
        relPath: 'src/a.c',
        language: 'c',
        kind: 'c',
        inside: true,
        exists: true,
        readable: true,
        functionCount: 2,
      },
      {
        id: 'file:src/b.c',
        path: 'src/b.c',
        relPath: 'src/b.c',
        language: 'c',
        kind: 'c',
        inside: true,
        exists: true,
        readable: true,
        functionCount: 1,
      },
    ],
    functions: [
      // External global helper in b.c (appears first in array)
      {
        id: 'fn:src/b.c:helper:1',
        fileId: 'file:src/b.c',
        name: 'helper',
        line: 1,
        endLine: 5,
        isStatic: false,
        isInterrupt: false,
        parameters: [],
      },
      // Local static helper in a.c
      {
        id: 'fn:src/a.c:helper:1',
        fileId: 'file:src/a.c',
        name: 'helper',
        line: 1,
        endLine: 5,
        isStatic: true,
        isInterrupt: false,
        parameters: [],
      },
      // Caller in a.c
      {
        id: 'fn:src/a.c:caller:10',
        fileId: 'file:src/a.c',
        name: 'caller',
        line: 10,
        endLine: 15,
        isStatic: false,
        isInterrupt: false,
        parameters: [],
      },
    ],
    variables: [],
    callEdges: [
      {
        id: 'call:fn:src/a.c:caller:10->helper@12',
        callerId: 'fn:src/a.c:caller:10',
        calleeName: 'helper',
        confidence: 'heuristic',
        location: { file: 'src/a.c', line: 12 },
      },
    ],
    includeEdges: [],
    readEdges: [],
    writeEdges: [],
    conditions: [],
  }

  resolveModelReferences(model)

  const edge = model.callEdges[0]
  assert.equal(edge.confidence, 'exact')
  assert.equal(
    edge.calleeId,
    'fn:src/a.c:helper:1',
    'Must link to local static function in src/a.c, not external function in src/b.c',
  )
})
