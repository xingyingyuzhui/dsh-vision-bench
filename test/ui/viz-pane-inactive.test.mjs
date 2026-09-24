// @ts-check
import assert from 'node:assert/strict'
import test from 'node:test'
import { plotBox, plotPaneInactive } from '../../src/ui/monitor/visualization/hooks/use-viz-charts.mjs'

test('plotPaneInactive detects kept-mounted inactive workspace panes', () => {
  const pane = {
    getAttribute(name) {
      return name === 'data-active' ? 'false' : null
    },
  }
  const node = {
    closest(sel) {
      return sel === '.dvb-ws-pane' ? pane : null
    },
  }
  assert.equal(plotPaneInactive(node), true)
  pane.getAttribute = (name) => (name === 'data-active' ? 'true' : null)
  assert.equal(plotPaneInactive(node), false)
  assert.equal(plotPaneInactive(null), false)
})

test('plotBox still requires a real pixel box before init', () => {
  assert.deepEqual(plotBox({ clientWidth: 7, clientHeight: 100 }), { width: 7, height: 100, ready: false })
  assert.deepEqual(plotBox({ clientWidth: 120, clientHeight: 80 }), { width: 120, height: 80, ready: true })
})
