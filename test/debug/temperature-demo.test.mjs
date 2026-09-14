import assert from 'node:assert/strict'
import test from 'node:test'
import {
  DEMO_CALL_GRAPH_NODES,
  DEMO_DEBUG_SESSION,
  DEMO_PROJECT_MAP,
  DEMO_SOURCE_FILES,
  demoFileText,
} from '../../src/ui/debug/fixtures/temperature-demo.mjs'

test('TemperatureDemo fixture holds sources, map, call graph and debug session', () => {
  assert.match(DEMO_SOURCE_FILES['sensor.c'], /float ReadTemperature/)
  assert.equal(demoFileText('sensor.c'), DEMO_SOURCE_FILES['sensor.c'])
  assert.equal(DEMO_PROJECT_MAP.project, 'TemperatureDemo.uvprojx')
  assert.ok(DEMO_CALL_GRAPH_NODES.some((n) => n.name === 'ReadTemperature'))
  assert.equal(DEMO_DEBUG_SESSION.location.line, 7)
  assert.equal(DEMO_DEBUG_SESSION.breakpoints.length, 2)
  assert.equal(DEMO_DEBUG_SESSION.events.length, 3)
})
