import { fnOptionLabel } from './hmi-ids.mjs'

/** Batch point add panel for one device. */
export function renderBatchPanel(el, t, ctx) {
  const { field, batch, setBatch, cwd, generateBatch } = ctx
  void ctx.d
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
          placeholder: 'HR',
          onChange: (event) => {
            setBatch((prev) => ({ ...prev, prefix: event.target.value }))
          },
        }),
      ),
      field(
        t('ptFc'),
        el(
          'select',
          {
            className: 'dvb-input',
            value: String(batch.fc),
            onChange: (event) => {
              setBatch((prev) => ({ ...prev, fc: Number(event.target.value) }))
            },
          },
          el('option', { value: '1' }, fnOptionLabel(t, 1)),
          el('option', { value: '3' }, fnOptionLabel(t, 3)),
        ),
      ),
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
