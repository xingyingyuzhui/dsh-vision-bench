import assert from 'node:assert/strict'
import test from 'node:test'
import {
  buildProgramModelFromKeilMap,
  createProgramModel,
  exportProgramModelSummary,
  findFileById,
  findFileByPath,
  findFunctionById,
  findFunctionsByName,
  findFunctionsInFile,
  findVariableById,
  getCallsFrom,
  getCallsTo,
  getConditionsIn,
  getIncludeEdgesFrom,
  getIncludeEdgesTo,
  getReadersOf,
  getReadsBy,
  getWritersOf,
  getWritesBy,
  makeCallEdgeId,
  makeConditionId,
  makeDataEdgeId,
  makeFileId,
  makeFunctionId,
  makeIncludeEdgeId,
  makeVariableId,
  normalizeRelPath,
  validateProgramModel,
} from '../../src/domain/program/program-model.mjs'

test('program-model: stable ID generation format and path normalization', () => {
  assert.equal(normalizeRelPath('.\\Core\\Src\\main.c'), 'Core/Src/main.c')
  assert.equal(normalizeRelPath('./Core/Src/main.c'), 'Core/Src/main.c')
  assert.equal(normalizeRelPath('Core\\Inc\\main.h'), 'Core/Inc/main.h')

  // File ID: file:<normalized-rel-path>
  assert.equal(makeFileId('.\\Core\\Src\\main.c'), 'file:Core/Src/main.c')

  // Function ID: fn:<file>:<name>:<line>
  assert.equal(makeFunctionId('Core/Src/main.c', 'SystemClock_Config', 45), 'fn:Core/Src/main.c:SystemClock_Config:45')

  // Variable ID: var:<scope>:<name>
  assert.equal(makeVariableId('global', 'eev_target'), 'var:global:eev_target')
  assert.equal(makeVariableId('file:Core/Src/main.c', 'counter'), 'var:file:Core/Src/main.c:counter')

  // Call Edge ID: call:<callerId>-><calleeId>@<line>
  const callerId = 'fn:Core/Src/main.c:main:20'
  assert.equal(
    makeCallEdgeId(callerId, 'SystemClock_Config', 25),
    'call:fn:Core/Src/main.c:main:20->SystemClock_Config@25',
  )

  // Include Edge ID: inc:<fromFile>-><toFile>
  assert.equal(makeIncludeEdgeId('Core\\Src\\main.c', 'Core\\Inc\\main.h'), 'inc:Core/Src/main.c->Core/Inc/main.h')

  // Data Edge ID: data:<kind>:<accessorId>-><varId>@<line>
  assert.equal(
    makeDataEdgeId('write', callerId, 'var:global:eev_target', 30),
    'data:write:fn:Core/Src/main.c:main:20->var:global:eev_target@30',
  )

  // Condition ID: cond:<fnId>:<type>@<line>
  assert.equal(makeConditionId(callerId, 'if', 28), 'cond:fn:Core/Src/main.c:main:20:if@28')
})

test('program-model: createProgramModel returns initialized canonical model', () => {
  const model = createProgramModel({
    project: 'E:/proj/app.uvprojx',
    target: 'STM32F401',
  })
  assert.equal(model.project, 'E:/proj/app.uvprojx')
  assert.equal(model.target, 'STM32F401')
  assert.deepEqual(model.files, [])
  assert.deepEqual(model.functions, [])
  assert.deepEqual(model.variables, [])
  assert.deepEqual(model.callEdges, [])
  assert.deepEqual(model.includeEdges, [])
  assert.deepEqual(model.readEdges, [])
  assert.deepEqual(model.writeEdges, [])
  assert.deepEqual(model.conditions, [])
  assert.deepEqual(model.tasks, [])

  const validation = validateProgramModel(model)
  assert.equal(validation.valid, true)
  assert.equal(validation.errors.length, 0)
})

test('program-model: buildProgramModelFromKeilMap converts legacy Keil Map DTO into canonical model', () => {
  const sampleKeilMap = {
    project: 'C:/workspace/demo.uvprojx',
    target: 'Target 1',
    groups: [
      {
        name: 'Application/User',
        files: [
          {
            name: 'main.c',
            rel: 'Core/Src/main.c',
            kind: 'c',
            inside: true,
            exists: true,
            readable: true,
            functions: [
              { name: 'main', line: 15 },
              { name: 'SystemClock_Config', line: 50 },
            ],
          },
          {
            name: 'app.c',
            rel: 'Core/Src/app.c',
            kind: 'c',
            inside: true,
            exists: true,
            readable: true,
            functions: [{ name: 'App_Init', line: 10 }],
          },
        ],
      },
      {
        name: 'Drivers/CMSIS',
        files: [
          {
            name: 'system_stm32f4xx.c',
            rel: 'Drivers/CMSIS/system_stm32f4xx.c',
            kind: 'c',
            inside: true,
            exists: true,
            readable: true,
            functions: [{ name: 'SystemInit', line: 80 }],
          },
        ],
      },
    ],
    includes: [{ path: 'Core/Inc', exists: true, inside: true }],
    defines: ['USE_HAL_DRIVER', 'STM32F401xE'],
    include_edges: [
      { from: 'Core/Src/main.c', name: 'main.h', to: 'Core/Inc/main.h', resolved: true },
      { from: 'Core/Src/main.c', name: 'missing.h', to: '', resolved: false },
    ],
    truncated: { files: false, includes: false, defines: false, include_edges: false, functions: false },
    limits: { files: 500, includes: 80, defines: 80, include_edges: 400, functions: 1200 },
    counts: { groups: 2, files: 3, missing: 0, unreadable: 0, includes: 1, defines: 2, include_edges: 2, functions: 4 },
  }

  const model = buildProgramModelFromKeilMap(sampleKeilMap, { workspaceCwd: 'C:/workspace' })
  assert.equal(model.project, 'C:/workspace/demo.uvprojx')
  assert.equal(model.target, 'Target 1')
  assert.equal(model.files.length, 3)
  assert.equal(model.functions.length, 4)
  assert.equal(model.includeEdges.length, 2)

  // Verify file IDs
  const mainFile = findFileById(model, 'file:Core/Src/main.c')
  assert.ok(mainFile)
  assert.equal(mainFile.name, 'main.c')
  assert.equal(mainFile.group, 'Application/User')
  assert.equal(mainFile.functionCount, 2)

  // Verify lookup by relative path
  const appFile = findFileByPath(model, 'Core/Src/app.c')
  assert.ok(appFile)
  assert.equal(appFile.id, 'file:Core/Src/app.c')

  // Verify function IDs
  const mainFn = findFunctionById(model, 'fn:Core/Src/main.c:main:15')
  assert.ok(mainFn)
  assert.equal(mainFn.name, 'main')
  assert.equal(mainFn.line, 15)
  assert.equal(mainFn.fileId, 'file:Core/Src/main.c')

  const sysInitFns = findFunctionsByName(model, 'SystemInit')
  assert.equal(sysInitFns.length, 1)
  assert.equal(sysInitFns[0].id, 'fn:Drivers/CMSIS/system_stm32f4xx.c:SystemInit:80')

  const fnsInMain = findFunctionsInFile(model, 'file:Core/Src/main.c')
  assert.equal(fnsInMain.length, 2)

  // Verify include edges
  const incFromMain = getIncludeEdgesFrom(model, 'file:Core/Src/main.c')
  assert.equal(incFromMain.length, 2)
  assert.equal(incFromMain[0].resolved, true)
  assert.equal(incFromMain[0].confidence, 'exact')
  assert.equal(incFromMain[1].resolved, false)
  assert.equal(incFromMain[1].confidence, 'unresolved')

  const incToMainH = getIncludeEdgesTo(model, 'file:Core/Inc/main.h')
  assert.equal(incToMainH.length, 1)

  // Verify summary
  const summary = exportProgramModelSummary(model)
  assert.equal(summary.fileCount, 3)
  assert.equal(summary.functionCount, 4)
  assert.equal(summary.includeEdgeCount, 2)
  assert.equal(summary.project, 'C:/workspace/demo.uvprojx')
})

test('program-model: query helpers for calls, reads, writes, and conditions', () => {
  const callerFnId = 'fn:Core/Src/main.c:main:15'
  const calleeFnId = 'fn:Core/Src/main.c:SystemClock_Config:50'
  const varId = 'var:global:eev_target'

  const model = createProgramModel({
    project: 'test.uvprojx',
    target: 'Default',
    functions: [
      { id: callerFnId, fileId: 'file:Core/Src/main.c', name: 'main', line: 15 },
      { id: calleeFnId, fileId: 'file:Core/Src/main.c', name: 'SystemClock_Config', line: 50 },
    ],
    variables: [{ id: varId, name: 'eev_target', scope: 'global', type: 'uint32_t' }],
    callEdges: [
      {
        id: makeCallEdgeId(callerFnId, calleeFnId, 22),
        callerId: callerFnId,
        calleeId: calleeFnId,
        calleeName: 'SystemClock_Config',
        confidence: 'parsed',
        location: { file: 'Core/Src/main.c', line: 22 },
      },
    ],
    readEdges: [
      {
        id: makeDataEdgeId('read', callerFnId, varId, 25),
        kind: 'read',
        accessorId: callerFnId,
        variableId: varId,
        variableName: 'eev_target',
        confidence: 'parsed',
        location: { file: 'Core/Src/main.c', line: 25 },
      },
    ],
    writeEdges: [
      {
        id: makeDataEdgeId('write', callerFnId, varId, 30),
        kind: 'write',
        accessorId: callerFnId,
        variableId: varId,
        variableName: 'eev_target',
        confidence: 'parsed',
        location: { file: 'Core/Src/main.c', line: 30 },
      },
    ],
    conditions: [
      {
        id: makeConditionId(callerFnId, 'if', 24),
        functionId: callerFnId,
        type: 'if',
        referencedVariableIds: [varId],
        location: { file: 'Core/Src/main.c', line: 24 },
      },
    ],
  })

  // Verify variable lookup
  const variable = findVariableById(model, varId)
  assert.ok(variable)
  assert.equal(variable.name, 'eev_target')
  assert.equal(variable.type, 'uint32_t')

  // Verify call edge queries
  const callsOut = getCallsFrom(model, callerFnId)
  assert.equal(callsOut.length, 1)
  assert.equal(callsOut[0].calleeId, calleeFnId)

  const callsIn = getCallsTo(model, calleeFnId)
  assert.equal(callsIn.length, 1)
  assert.equal(callsIn[0].callerId, callerFnId)

  // Verify data edge queries
  const reads = getReadsBy(model, callerFnId)
  assert.equal(reads.length, 1)
  assert.equal(reads[0].variableId, varId)

  const writes = getWritesBy(model, callerFnId)
  assert.equal(writes.length, 1)
  assert.equal(writes[0].variableId, varId)

  const readers = getReadersOf(model, varId)
  assert.equal(readers.length, 1)
  assert.equal(readers[0].accessorId, callerFnId)

  const writers = getWritersOf(model, varId)
  assert.equal(writers.length, 1)
  assert.equal(writers[0].accessorId, callerFnId)

  // Verify condition queries
  const conds = getConditionsIn(model, callerFnId)
  assert.equal(conds.length, 1)
  assert.equal(conds[0].type, 'if')
  assert.deepEqual(conds[0].referencedVariableIds, [varId])
})

test('program-model: validateProgramModel catches malformed inputs', () => {
  const invalid1 = validateProgramModel(null)
  assert.equal(invalid1.valid, false)

  const invalid2 = validateProgramModel({
    project: 123,
    target: null,
    files: 'not-an-array',
  })
  assert.equal(invalid2.valid, false)
  assert.ok(invalid2.errors.length >= 3)
})
