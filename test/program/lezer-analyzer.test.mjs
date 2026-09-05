import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCSourceHeuristic } from '../../src/infrastructure/program/heuristic-c-source-analyzer.mjs'
import { analyzeCSourceWithAst, analyzeCSourceWithLezer } from '../../src/infrastructure/program/lezer-c-analyzer.mjs'

test('lezer-c-analyzer: exports analyzeCSourceWithLezer with parser=lezer-cpp and confidence=ast', () => {
  const cCode = `
#include "stm32f4xx.h"
static uint32_t counter = 0;

static void increment(int step) {
  counter += step;
}

int main(void) {
  increment(1);
  return 0;
}
`
  const result = analyzeCSourceWithLezer(cCode, 'Core/Src/main.c')
  assert.equal(result.metadata?.parser, 'lezer-cpp')
  assert.equal(result.metadata?.confidence, 'ast')
  assert.equal(result.metadata?.preprocessed, false)
  assert.ok(Array.isArray(result.metadata?.preprocessors))

  // Compatibility alias
  const compatResult = analyzeCSourceWithAst(cCode, 'Core/Src/main.c')
  assert.equal(compatResult.metadata?.parser, 'lezer-cpp')
  assert.equal(compatResult.metadata?.confidence, 'ast')
})

test('heuristic-c-source-analyzer: returns parser=heuristic and confidence=heuristic', () => {
  const cCode = `
#include <stdio.h>
int main() {
  printf("hello");
  return 0;
}
`
  const result = analyzeCSourceHeuristic(cCode, 'main.c')
  assert.equal(result.metadata?.parser, 'heuristic')
  assert.equal(result.metadata?.confidence, 'heuristic')
  assert.equal(result.metadata?.preprocessed, false)
})
