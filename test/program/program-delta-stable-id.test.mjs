import assert from 'node:assert/strict'
import test from 'node:test'
import { createProgramModel } from '../../src/domain/program/program-model.mjs'
import { programDeltaToArchify } from '../../src/infrastructure/archify/archify-adapter.mjs'

test('programDeltaToArchify: distinguishes same-named static functions across different files by id', () => {
  // Two files each defining static void init()
  // Before: main.c:init and driver.c:init both exist
  const beforeModel = createProgramModel({
    files: [
      { id: 'file:main.c', name: 'main.c', rel: 'main.c', kind: 'c', inside: true, exists: true, readable: true },
      { id: 'file:driver.c', name: 'driver.c', rel: 'driver.c', kind: 'c', inside: true, exists: true, readable: true },
    ],
    functions: [
      { id: 'fn:main.c:init:10', name: 'init', fileId: 'file:main.c', line: 10, endLine: 20 },
      { id: 'fn:driver.c:init:15', name: 'init', fileId: 'file:driver.c', line: 15, endLine: 30 },
    ],
    variables: [
      { id: 'var:main.c:flag', name: 'flag', scope: 'static' },
      { id: 'var:driver.c:flag', name: 'flag', scope: 'static' },
    ],
  })

  // After: driver.c:init was removed, main.c:init was modified (line 12), and sensor.c:init was added
  const afterModel = createProgramModel({
    files: [
      { id: 'file:main.c', name: 'main.c', rel: 'main.c', kind: 'c', inside: true, exists: true, readable: true },
      { id: 'file:sensor.c', name: 'sensor.c', rel: 'sensor.c', kind: 'c', inside: true, exists: true, readable: true },
    ],
    functions: [
      { id: 'fn:main.c:init:10', name: 'init', fileId: 'file:main.c', line: 12, endLine: 22 }, // line changed -> modified
      { id: 'fn:sensor.c:init:5', name: 'init', fileId: 'file:sensor.c', line: 5, endLine: 18 }, // new static init in sensor.c
    ],
    variables: [
      { id: 'var:main.c:flag', name: 'flag', scope: 'static' },
      { id: 'var:sensor.c:flag', name: 'flag', scope: 'static' },
    ],
  })

  const delta = programDeltaToArchify(beforeModel, afterModel)

  // Added functions should be the new sensor.c init
  assert.equal(delta.addedFunctions.length, 1)
  assert.equal(delta.addedFunctions[0].id, 'fn:sensor.c:init:5')
  assert.equal(delta.addedFunctions[0].name, 'init')

  // Removed functions should be driver.c init
  assert.equal(delta.removedFunctions.length, 1)
  assert.equal(delta.removedFunctions[0].id, 'fn:driver.c:init:15')
  assert.equal(delta.removedFunctions[0].name, 'init')

  // Modified functions should be main.c init
  assert.equal(delta.modifiedFunctions.length, 1)
  assert.equal(delta.modifiedFunctions[0].id, 'fn:main.c:init:10')
  assert.equal(delta.modifiedFunctions[0].name, 'init')
  assert.equal(delta.modifiedFunctions[0].changes.newLine, 12)

  // Variable deltas by id
  assert.equal(delta.addedVariables.length, 1)
  assert.equal(delta.addedVariables[0].id, 'var:sensor.c:flag')
  assert.equal(delta.removedVariables.length, 1)
  assert.equal(delta.removedVariables[0].id, 'var:driver.c:flag')
})
