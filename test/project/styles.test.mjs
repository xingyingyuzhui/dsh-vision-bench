import assert from 'node:assert/strict'
import test from 'node:test'
import { CSS } from '../../bench-styles.mjs'
import { ATTR } from '../../src/ui/styles/base.mjs'
import { PROJECT_CSS } from '../../src/ui/styles/project.mjs'

test('工程结构 CSS 正确插值 data-dsh-vision-bench，缩放条不盖住输入框', () => {
  const css = PROJECT_CSS.join('\n')
  assert.equal(ATTR, 'data-dsh-vision-bench')
  assert.match(css, /body\[data-dsh-vision-bench\] \.dvb-project\{/)
  assert.doesNotMatch(css, /body\[\$\{ATTR\}\]/)
  assert.match(CSS, /body\[data-dsh-vision-bench\] \.dvb-project\{/)
  assert.match(css, /\.dvb-graph-host\{[^}]*isolation:isolate/)
  assert.match(css, /\.dvb-graph-zoom-bar\{[^}]*z-index:0/)
  assert.doesNotMatch(css, /\.dvb-graph-zoom-bar\{[^}]*z-index:10/)
  assert.doesNotMatch(css, /\.dvb-graph-zoom-bar\{[^}]*--dsh-composer-height/)
})
