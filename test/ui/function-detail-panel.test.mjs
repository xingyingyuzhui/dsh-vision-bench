import assert from 'node:assert/strict'
import test from 'node:test'
import { functionSnippetView } from '../../src/ui/debug/project/function-detail-panel.mjs'
import { DEMO_CALL_GRAPH_NODES } from '../../src/ui/debug/fixtures/temperature-demo.mjs'

test('源码片段用函数真实行号，空节点没有兜底源码', () => {
  const empty = functionSnippetView({})
  assert.deepEqual(empty.lines, [])
  const node = DEMO_CALL_GRAPH_NODES.find((n) => n.name === 'ReadTemperature')
  assert.ok(node?.snippet)
  const view = functionSnippetView(node)
  assert.equal(view.start, 3)
  assert.equal(view.lines[0], 'float ReadTemperature(void)')
  assert.ok(view.lines.some((l) => l.includes('ReadVoltage')))
  const callee = node.callees[0]
  assert.equal(callee.expanded, false)
  assert.equal(callee.name, 'ReadVoltage')
})
