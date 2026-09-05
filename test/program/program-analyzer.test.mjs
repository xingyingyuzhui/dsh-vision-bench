import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgramModel } from '../../src/domain/program/program-model.mjs'
import {
  analyzeCSource,
  resolveModelReferences,
  sanitizeCSource,
} from '../../src/infrastructure/program/c-source-analyzer.mjs'

test('c-source-analyzer: sanitizeCSource strips comments and strings while preserving line numbers', () => {
  const source = `// Header comment
#include "test.h"

/* Multi-line
   comment block */
int test_fn(void) {
  char *str = "a string with /* comment-like */ and // text";
  char ch = 'x';
  return 0;
}`

  const cleaned = sanitizeCSource(source)
  assert.equal(source.split('\n').length, cleaned.split('\n').length)
  assert.ok(!cleaned.includes('Header comment'))
  assert.ok(!cleaned.includes('Multi-line'))
  assert.ok(!cleaned.includes('comment block'))
  assert.ok(!cleaned.includes('a string with'))
  assert.ok(cleaned.includes('int test_fn(void)'))
  assert.ok(cleaned.includes('#include'))
})

test('c-source-analyzer: extracts functions, variables, calls, data writes/reads, and conditions', () => {
  const cCode = `#include "stm32f4xx.h"
#include "eev_ctrl.h"

static uint32_t eev_target = 0;
volatile uint8_t g_alarm_flag = 0;

void SystemInit(void) {
  // hardware config
}

static void LowLoad_Cutoff(float superheat) {
  if (superheat < 2.0f) {
    eev_target = 0;
    g_alarm_flag = 1;
  }
}

void PID_Step(void) {
  float sh = 1.2f;
  LowLoad_Cutoff(sh);
}
`

  const result = analyzeCSource(cCode, 'Core/Src/control.c')

  // 1. File metadata
  assert.equal(result.file.id, 'file:Core/Src/control.c')
  assert.equal(result.file.rel, 'Core/Src/control.c')

  // 2. Includes
  assert.equal(result.includeEdges.length, 2)
  assert.equal(result.includeEdges[0].headerName, 'stm32f4xx.h')
  assert.equal(result.includeEdges[1].headerName, 'eev_ctrl.h')

  // 3. Variables
  assert.equal(result.variables.length, 2)
  const eevVar = result.variables.find((v) => v.name === 'eev_target')
  assert.ok(eevVar)
  assert.equal(eevVar.isStatic, true)
  assert.equal(eevVar.scope, 'file:Core/Src/control.c')

  const alarmVar = result.variables.find((v) => v.name === 'g_alarm_flag')
  assert.ok(alarmVar)
  assert.equal(alarmVar.isVolatile, true)
  assert.equal(alarmVar.scope, 'global')

  // 4. Functions
  assert.equal(result.functions.length, 3)
  const sysInit = result.functions.find((fn) => fn.name === 'SystemInit')
  assert.ok(sysInit)

  const lowLoad = result.functions.find((fn) => fn.name === 'LowLoad_Cutoff')
  assert.ok(lowLoad)
  assert.equal(lowLoad.isStatic, true)

  const pidStep = result.functions.find((fn) => fn.name === 'PID_Step')
  assert.ok(pidStep)

  // 5. Calls
  assert.equal(result.callEdges.length, 1)
  assert.equal(result.callEdges[0].callerId, pidStep.id)
  assert.equal(result.callEdges[0].calleeName, 'LowLoad_Cutoff')
  assert.ok(result.callEdges[0].confidence === 'ast' || result.callEdges[0].confidence === 'heuristic')

  // 6. Writes (assignments)
  const writes = result.writeEdges.filter((w) => w.accessorId === lowLoad.id)
  assert.ok(writes.some((w) => w.variableName === 'eev_target'))
  assert.ok(writes.some((w) => w.variableName === 'g_alarm_flag'))

  // 7. Conditions
  assert.equal(result.conditions.length, 1)
  assert.equal(result.conditions[0].functionId, lowLoad.id)
  assert.equal(result.conditions[0].type, 'if')
  assert.deepEqual(result.conditions[0].referencedVariableIds, ['superheat'])
})

test('c-source-analyzer: resolveModelReferences links callee and variable IDs with exact confidence', () => {
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
        id: 'file:Core/Inc/main.h',
        name: 'main.h',
        rel: 'Core/Inc/main.h',
        kind: 'h',
        inside: true,
        exists: true,
        readable: true,
      },
    ],
    functions: [
      { id: 'fn:Core/Src/main.c:main:10', fileId: 'file:Core/Src/main.c', name: 'main', line: 10 },
      { id: 'fn:Core/Src/main.c:App_Init:30', fileId: 'file:Core/Src/main.c', name: 'App_Init', line: 30 },
    ],
    variables: [{ id: 'var:global:system_state', name: 'system_state', scope: 'global' }],
    callEdges: [
      {
        id: 'call:1',
        callerId: 'fn:Core/Src/main.c:main:10',
        calleeName: 'App_Init',
        confidence: 'parsed',
        location: { file: 'Core/Src/main.c', line: 15 },
      },
      {
        id: 'call:2',
        callerId: 'fn:Core/Src/main.c:main:10',
        calleeName: 'External_Library_Func',
        confidence: 'parsed',
        location: { file: 'Core/Src/main.c', line: 20 },
      },
    ],
    writeEdges: [
      {
        id: 'write:1',
        kind: 'write',
        accessorId: 'fn:Core/Src/main.c:App_Init:30',
        variableName: 'system_state',
        confidence: 'parsed',
        location: { file: 'Core/Src/main.c', line: 32 },
      },
    ],
    includeEdges: [
      {
        id: 'inc:1',
        fromFileId: 'file:Core/Src/main.c',
        toFileId: 'file:Core/Inc/main.h',
        headerName: 'main.h',
        resolved: false,
        confidence: 'unresolved',
      },
    ],
  })

  resolveModelReferences(model)

  // Internal call resolved to exact
  assert.equal(model.callEdges[0].calleeId, 'fn:Core/Src/main.c:App_Init:30')
  assert.equal(model.callEdges[0].confidence, 'exact')

  // Unresolved external call remains unresolved
  assert.equal(model.callEdges[1].calleeId, undefined)
  assert.equal(model.callEdges[1].confidence, 'unresolved')

  // Variable write edge resolved to exact
  assert.equal(model.writeEdges[0].variableId, 'var:global:system_state')
  assert.equal(model.writeEdges[0].confidence, 'exact')

  // Include edge resolved to exact
  assert.equal(model.includeEdges[0].resolved, true)
  assert.equal(model.includeEdges[0].confidence, 'exact')
})

test('c-source-analyzer: gracefully handles syntax errors, complex macros and unclosed braces', () => {
  const malformedC = `
#define MACRO_OPEN {
#define MACRO_CLOSE }

void broken_function( {
  invalid tokens !@#$%^&*()
  if (unclosed_condition
}
`

  assert.doesNotThrow(() => {
    const result = analyzeCSource(malformedC, 'broken.c')
    assert.ok(result)
    assert.equal(result.file.rel, 'broken.c')
  })
})
