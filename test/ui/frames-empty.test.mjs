import assert from 'node:assert/strict'
import test from 'node:test'
import { framesQueryActive, renderFramesListEmpty } from '../../src/ui/monitor/frames/frames-page.mjs'
import { el } from '../helpers/react-unit.mjs'

const t = (key) =>
  ({
    framesEmpty: '暂无报文，读写点表后显示',
    framesEmptyFiltered: '没有符合当前筛选的报文',
    framesEmptyFilteredHint: '调整筛选或清空搜索后再看',
  })[key] || key

test('frames list empty copy follows whether a filter is active', () => {
  assert.equal(framesQueryActive({ search: '', filters: {} }), false)
  assert.equal(framesQueryActive({ search: ' 03 ', filters: {} }), true)
  assert.equal(framesQueryActive({ search: '', filters: { source: 'agent' } }), true)

  const idle = renderFramesListEmpty(el, t, false)
  assert.equal(idle.props.role, 'status')
  assert.equal(idle.props['aria-live'], 'polite')
  assert.equal(idle.children[0].children[0], '暂无报文，读写点表后显示')

  const filtered = renderFramesListEmpty(el, t, true)
  assert.equal(filtered.children[0].children[0], '没有符合当前筛选的报文')
  assert.equal(filtered.children[1].children[0], '调整筛选或清空搜索后再看')
})
