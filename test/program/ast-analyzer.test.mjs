import assert from 'node:assert/strict'
import test from 'node:test'
import { analyzeCSourceWithAst, analyzeCSourceWithLezer } from '../../src/infrastructure/program/lezer-c-analyzer.mjs'

test('tree-sitter-c-analyzer: extracts functions, parameters, calls, and variables with confidence: ast', () => {
  const cCode = `
#include "stm32f4xx.h"
#include <stdint.h>

#define MAX_SAMPLES 128

static uint32_t counter = 0;
volatile uint8_t alarm_state = 0;

static void update_state(int delta) {
  if (delta > 0) {
    counter += delta;
    alarm_state = 1;
  }
}

int main(void) {
  update_state(5);
  return 0;
}
`

  const result = analyzeCSourceWithAst(cCode, 'Core/Src/main.c')

  // File metadata
  assert.equal(result.file.id, 'file:Core/Src/main.c')
  assert.equal(result.file.rel, 'Core/Src/main.c')
  assert.equal(result.metadata?.confidence, 'ast')
  assert.ok(result.metadata?.preprocessors.length >= 2)

  // Includes
  assert.equal(result.includeEdges.length, 2)
  assert.equal(result.includeEdges[0].headerName, 'stm32f4xx.h')
  assert.equal(result.includeEdges[1].headerName, 'stdint.h')

  // Functions
  assert.equal(result.functions.length, 2)
  const updateFn = result.functions.find((f) => f.name === 'update_state')
  assert.ok(updateFn)
  assert.equal(updateFn.isStatic, true)
  assert.equal(updateFn.parameters?.length, 1)
  assert.equal(updateFn.parameters[0].name, 'delta')

  const mainFn = result.functions.find((f) => f.name === 'main')
  assert.ok(mainFn)

  // Call Edges
  assert.equal(result.callEdges.length, 1)
  assert.equal(result.callEdges[0].callerId, mainFn.id)
  assert.equal(result.callEdges[0].calleeName, 'update_state')
  assert.equal(result.callEdges[0].confidence, 'ast')
  assert.ok(result.callEdges[0].location.line > 0)

  // Writes
  const updateWrites = result.writeEdges.filter((w) => w.accessorId === updateFn.id)
  assert.ok(updateWrites.some((w) => w.variableName === 'counter'))
  assert.ok(updateWrites.some((w) => w.variableName === 'alarm_state'))
  assert.ok(updateWrites.every((w) => w.confidence === 'ast'))

  // Conditions
  const conds = result.conditions.filter((c) => c.functionId === updateFn.id)
  assert.equal(conds.length, 1)
  assert.equal(conds[0].type, 'if')
  assert.deepEqual(conds[0].referencedVariableIds, ['delta'])
})

test('tree-sitter-c-analyzer: handles complex expressions, loops, and field accesses', () => {
  const cCode = `
typedef struct {
  int value;
} State_t;

static State_t g_state;

void Loop_Task(State_t *p) {
  while (g_state.value < 100) {
    p->value++;
    g_state.value += 1;
  }
}
`

  const result = analyzeCSourceWithAst(cCode, 'Core/Src/task.c')
  assert.equal(result.functions.length, 1)
  const fn = result.functions[0]
  assert.equal(fn.name, 'Loop_Task')

  // Condition should be 'while'
  assert.equal(result.conditions.length, 1)
  assert.equal(result.conditions[0].type, 'while')

  // Field writes
  const writes = result.writeEdges.filter((w) => w.accessorId === fn.id)
  assert.ok(writes.length >= 1)
})
