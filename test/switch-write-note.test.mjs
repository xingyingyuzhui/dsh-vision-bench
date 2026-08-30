import assert from 'node:assert/strict'
import test from 'node:test'
import { formatSwitchWriteNote } from '../bench-visualization-model.mjs'

test('开关写入提示对齐 outcomeUnknown / ok / readback[]', async () => {
  assert.equal(formatSwitchWriteNote({ ok: true, readback: [1] }, true), '目标 开 → 回读 1 → 一致')
  assert.equal(formatSwitchWriteNote({ ok: true, readback: [0] }, false), '目标 关 → 回读 0 → 一致')
  assert.equal(formatSwitchWriteNote({ ok: false, outcomeUnknown: true }, true), '目标 开 → 回读未知 → 结果未知')
  assert.equal(
    formatSwitchWriteNote({ ok: false, readback: [0], error: '回读不一致' }, true),
    '目标 开 → 回读 0 → 不一致',
  )
  assert.equal(formatSwitchWriteNote({ ok: false, error: '设备离线' }, true), '设备离线')
  // 旧字段 unknown 仍兼容
  assert.equal(formatSwitchWriteNote({ ok: true, unknown: true, readback: [1] }, true), '目标 开 → 回读未知 → 结果未知')
})
