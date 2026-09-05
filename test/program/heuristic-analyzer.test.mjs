import assert from 'node:assert/strict'
import test from 'node:test'
import {
  analyzeCSourceHeuristic,
  sanitizeCSource,
} from '../../src/infrastructure/program/heuristic-c-source-analyzer.mjs'

test('heuristic-c-source-analyzer: sanitizeCSource strips comments and preserves line counts', () => {
  const code = `// line 1
/* line 2
   line 3 */
int x = 42;
`
  const cleaned = sanitizeCSource(code)
  assert.equal(code.split('\n').length, cleaned.split('\n').length)
  assert.ok(!cleaned.includes('line 1'))
  assert.ok(cleaned.includes('int x = 42;'))
})

test('heuristic-c-source-analyzer: emits confidence: heuristic for all edges', () => {
  const code = `
static int g_val = 0;

static void inc(void) {
  g_val++;
}

void run(void) {
  if (g_val == 0) {
    inc();
  }
}
`

  const result = analyzeCSourceHeuristic(code, 'src/test.c')
  assert.equal(result.functions.length, 2)
  assert.equal(result.variables.length, 1)

  // Every call edge must have confidence: 'heuristic'
  assert.equal(result.callEdges.length, 1)
  assert.equal(result.callEdges[0].confidence, 'heuristic')

  // Every write edge must have confidence: 'heuristic'
  assert.ok(result.writeEdges.length >= 1)
  for (const w of result.writeEdges) {
    assert.equal(w.confidence, 'heuristic')
  }
})
