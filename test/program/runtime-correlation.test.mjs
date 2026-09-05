import assert from 'node:assert/strict'
import test from 'node:test'
import {
  correlateRuntimeLocation,
  createRuntimeCorrelationService,
} from '../../src/application/program/runtime-correlation-service.mjs'
import { createProgramModel } from '../../src/domain/program/program-model.mjs'

test('runtime-correlation: maps runtime file and line to function, callers, callees, and conditions', () => {
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
      {
        id: 'fn:Core/Src/control.c:SystemInit:10',
        fileId: 'file:Core/Src/control.c',
        name: 'SystemInit',
        line: 10,
        endLine: 20,
      },
      {
        id: 'fn:Core/Src/control.c:LowLoad_Cutoff:30',
        fileId: 'file:Core/Src/control.c',
        name: 'LowLoad_Cutoff',
        line: 30,
        endLine: 50,
      },
      {
        id: 'fn:Core/Src/control.c:PID_Step:60',
        fileId: 'file:Core/Src/control.c',
        name: 'PID_Step',
        line: 60,
        endLine: 80,
      },
    ],
    variables: [
      {
        id: 'var:global:eev_target',
        name: 'eev_target',
        scope: 'global',
        fileId: 'file:Core/Src/control.c',
        line: 5,
      },
    ],
    callEdges: [
      {
        id: 'call:1',
        callerId: 'fn:Core/Src/control.c:PID_Step:60',
        calleeId: 'fn:Core/Src/control.c:LowLoad_Cutoff:30',
        calleeName: 'LowLoad_Cutoff',
        confidence: 'exact',
        location: { file: 'Core/Src/control.c', line: 65 },
      },
    ],
    writeEdges: [
      {
        id: 'write:1',
        kind: 'write',
        accessorId: 'fn:Core/Src/control.c:LowLoad_Cutoff:30',
        variableId: 'var:global:eev_target',
        variableName: 'eev_target',
        confidence: 'exact',
        location: { file: 'Core/Src/control.c', line: 40 },
      },
    ],
    conditions: [
      {
        id: 'cond:1',
        functionId: 'fn:Core/Src/control.c:LowLoad_Cutoff:30',
        type: 'if',
        referencedVariableIds: ['superheat'],
        location: { file: 'Core/Src/control.c', line: 35 },
      },
    ],
  })

  // Correlate location inside LowLoad_Cutoff (line 40)
  const result = correlateRuntimeLocation(model, {
    file: 'Core/Src/control.c',
    line: 40,
    function: 'LowLoad_Cutoff',
  })

  assert.equal(result.functionNodeId, 'fn:Core/Src/control.c:LowLoad_Cutoff:30')
  assert.equal(result.functionName, 'LowLoad_Cutoff')
  assert.equal(result.confidence, 'exact')

  // Caller should be PID_Step
  assert.equal(result.callers.length, 1)
  assert.equal(result.callers[0].id, 'fn:Core/Src/control.c:PID_Step:60')
  assert.equal(result.callers[0].name, 'PID_Step')

  // Dependent variables should include eev_target
  assert.ok(result.variableNodeIds.includes('var:global:eev_target'))

  // Nearest condition should be the if statement at line 35
  assert.equal(result.nearestConditions.length, 1)
  assert.equal(result.nearestConditions[0].id, 'cond:1')
})

test('runtime-correlation: createRuntimeCorrelationService delegates correctly', async () => {
  const model = createProgramModel({
    files: [
      { id: 'file:main.c', name: 'main.c', rel: 'main.c', kind: 'c', inside: true, exists: true, readable: true },
    ],
    functions: [{ id: 'fn:main:1', fileId: 'file:main.c', name: 'main', line: 1, endLine: 10 }],
  })

  const mockProgramService = {
    loadProgramModel: async () => model,
  }

  const service = createRuntimeCorrelationService({ programService: mockProgramService })
  const result = await service.correlateFromProject('C:/ws', 'prj.uvprojx', 'Target 1', {
    file: 'main.c',
    line: 5,
  })

  assert.equal(result.functionNodeId, 'fn:main:1')
})
