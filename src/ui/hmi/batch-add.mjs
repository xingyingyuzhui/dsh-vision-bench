import { renderCustomSelect } from '../components/custom-select.mjs'
import { fnOptionLabel } from './hmi-ids.mjs'

/** Batch point add panel for one device. */
export function renderBatchPanel(el, t, ctx) {
  const { field, batch, setBatch, cwd, generateBatch, CustomSelect } = ctx
  void ctx.d
  const fcSelectProps = {
    size: 'sm',
    value: String(batch.fc),
    options: [
      { value: '1', label: fnOptionLabel(t, 1), title: '01 线圈 (可读写)' },
      { value: '3', label: fnOptionLabel(t, 3), title: '03 保持寄存器 (可读写)' },
    ],
    onChange: (val) => {
      const next = val?.target ? val.target.value : val
      setBatch((prev) => ({ ...prev, fc: Number(next) }))
    },
  }
  const fcSelectNode = CustomSelect ? el(CustomSelect, fcSelectProps) : renderCustomSelect(el, fcSelectProps)

  return el(
    'div',
    { className: 'dvb-write-panel dvb-batch-panel' },
    el(
      'div',
      { className: 'dvb-toolbar' },
      field(
        t('batchPrefix'),
        el('input', {
          className: 'dvb-input',
          value: batch.prefix,
          placeholder: '03',
          onChange: (event) => {
            setBatch((prev) => ({ ...prev, prefix: event.target.value }))
          },
        }),
      ),
      field(t('ptFc'), fcSelectNode),
      field(
        t('batchStart'),
        el('input', {
          className: 'dvb-input dvb-input-mono',
          type: 'number',
          value: batch.start,
          min: 0,
          max: 65535,
          onChange: (event) => {
            setBatch((prev) => ({ ...prev, start: Number(event.target.value) }))
          },
        }),
      ),
      field(
        t('batchCount'),
        el('input', {
          className: 'dvb-input dvb-input-mono',
          type: 'number',
          value: batch.count,
          min: 1,
          max: 64,
          onChange: (event) => {
            setBatch((prev) => ({ ...prev, count: Number(event.target.value) }))
          },
        }),
      ),
      el(
        'button',
        { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: generateBatch },
        t('batchGenerate'),
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn',
          onClick() {
            setBatch((prev) => ({ ...prev, open: false }))
          },
        },
        t('csvCancel') || '收起',
      ),
    ),
  )
}
