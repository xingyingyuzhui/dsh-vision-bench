import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgramService } from '../../src/application/program/program-service.mjs'

test('program-service: loadProgramModel builds enriched model with calls and variables', async () => {
  const mockKeilMap = {
    project: '/workspace/app.uvprojx',
    target: 'Release',
    groups: [
      {
        name: 'User',
        files: [
          {
            name: 'main.c',
            rel: 'Src/main.c',
            kind: 'c',
            inside: true,
            exists: true,
            readable: true,
            functions: [{ name: 'main', line: 10 }],
          },
        ],
      },
    ],
    includes: [],
    defines: [],
    include_edges: [],
  }

  const mockMainSource = `
static uint32_t sensor_target = 100;

void ProcessTarget(void) {
  sensor_target = 200;
}

int main(void) {
  ProcessTarget();
  return 0;
}
`

  let mapCalls = 0
  let readCalls = 0

  const service = createProgramService({
    mapProjectFn: async () => {
      mapCalls++
      return mockKeilMap
    },
    readSourceFn: async () => {
      readCalls++
      return mockMainSource
    },
  })

  const model = await service.loadProgramModel('/workspace', '/workspace/app.uvprojx', 'Release')
  assert.equal(mapCalls, 1)
  assert.ok(readCalls >= 1)

  // Verify functions
  assert.ok(model.functions.some((fn) => fn.name === 'ProcessTarget'))
  assert.ok(model.functions.some((fn) => fn.name === 'main'))

  // Verify variable
  const targetVar = model.variables.find((v) => v.name === 'sensor_target')
  assert.ok(targetVar)

  // Verify call edge
  const mainFn = model.functions.find((fn) => fn.name === 'main')
  const processFn = model.functions.find((fn) => fn.name === 'ProcessTarget')
  assert.ok(mainFn)
  assert.ok(processFn)

  const callEdge = model.callEdges.find((e) => e.callerId === mainFn.id)
  assert.ok(callEdge)
  assert.equal(callEdge.calleeId, processFn.id)
  assert.equal(callEdge.confidence, 'exact')

  // Verify write edge
  const writeEdge = model.writeEdges.find((w) => w.accessorId === processFn.id)
  assert.ok(writeEdge)
  assert.equal(writeEdge.variableId, targetVar.id)
  assert.equal(writeEdge.confidence, 'exact')

  // Test caching
  const cachedModel = await service.loadProgramModel('/workspace', '/workspace/app.uvprojx', 'Release')
  assert.equal(mapCalls, 1, 'Repeat call should be served from memory cache')
  assert.equal(cachedModel, model)

  // Test force refresh
  await service.loadProgramModel('/workspace', '/workspace/app.uvprojx', 'Release', { forceRefresh: true })
  assert.equal(mapCalls, 2, 'Force refresh should reload project')
})

test('program-service: filterProgramGraph filters nodes and edges around focus', async () => {
  const service = createProgramService()

  const model = {
    project: 'test.uvprojx',
    target: 'Default',
    files: [
      { id: 'file:Src/a.c', name: 'a.c', rel: 'Src/a.c', kind: 'c', inside: true, exists: true, readable: true },
      { id: 'file:Src/b.c', name: 'b.c', rel: 'Src/b.c', kind: 'c', inside: true, exists: true, readable: true },
    ],
    functions: [
      { id: 'fn:Src/a.c:funcA:5', fileId: 'file:Src/a.c', name: 'funcA', line: 5 },
      { id: 'fn:Src/a.c:funcB:15', fileId: 'file:Src/a.c', name: 'funcB', line: 15 },
      { id: 'fn:Src/b.c:funcC:25', fileId: 'file:Src/b.c', name: 'funcC', line: 25 },
    ],
    variables: [
      { id: 'var:file:Src/a.c:varA', name: 'varA', scope: 'file:Src/a.c', fileId: 'file:Src/a.c' },
      { id: 'var:file:Src/b.c:varB', name: 'varB', scope: 'file:Src/b.c', fileId: 'file:Src/b.c' },
    ],
    callEdges: [
      {
        id: 'call:1',
        callerId: 'fn:Src/a.c:funcA:5',
        calleeId: 'fn:Src/a.c:funcB:15',
        calleeName: 'funcB',
        confidence: /** @type {const} */ ('exact'),
        location: { file: 'Src/a.c', line: 7 },
      },
      {
        id: 'call:2',
        callerId: 'fn:Src/a.c:funcB:15',
        calleeId: 'fn:Src/b.c:funcC:25',
        calleeName: 'funcC',
        confidence: /** @type {const} */ ('exact'),
        location: { file: 'Src/a.c', line: 18 },
      },
    ],
    readEdges: [
      {
        id: 'read:1',
        kind: /** @type {const} */ ('read'),
        accessorId: 'fn:Src/a.c:funcA:5',
        variableId: 'var:file:Src/a.c:varA',
        variableName: 'varA',
        confidence: /** @type {const} */ ('exact'),
        location: { file: 'Src/a.c', line: 6 },
      },
    ],
    writeEdges: [],
    conditions: [
      {
        id: 'cond:1',
        functionId: 'fn:Src/a.c:funcA:5',
        type: /** @type {const} */ ('if'),
        referencedVariableIds: ['var:file:Src/a.c:varA'],
        location: { file: 'Src/a.c', line: 6 },
      },
    ],
    includeEdges: [],
    tasks: [],
    metadata: {},
  }

  // Filter by function funcA (neighborhood)
  const filtered = service.filterProgramGraph(model, { functionId: 'fn:Src/a.c:funcA:5' })
  assert.equal(filtered.functions.length, 2) // funcA and called funcB
  assert.equal(filtered.variables.length, 1) // varA accessed by funcA
  assert.equal(filtered.callEdges.length, 1)
  assert.equal(filtered.readEdges.length, 1)
  assert.equal(filtered.conditions.length, 1)

  // Filter by file b.c
  const filteredFile = service.filterProgramGraph(model, { fileId: 'file:Src/b.c' })
  assert.equal(filteredFile.functions.length, 1)
  assert.equal(filteredFile.functions[0].name, 'funcC')
  assert.equal(filteredFile.variables.length, 1)
  assert.equal(filteredFile.variables[0].name, 'varB')
})
