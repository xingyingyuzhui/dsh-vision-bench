/** Inline current-value write cell. */
export function renderInlineWriteCell(el, t, ctx) {
  const { point, inlineWrite, setInlineWrite, submitWriteCell, openWriteCell, writable, shown, busy, writeRunning } =
    ctx
  const wCell = inlineWrite && inlineWrite.pointId === point.id
  if (wCell) {
    return el(
      'span',
      { className: 'dvb-inline-write' },
      point.function === 1
        ? el(
            'span',
            { className: 'dvb-actions', style: { gap: '4px' } },
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm' + (inlineWrite.text === '1' ? ' is-on' : ''),
                disabled: inlineWrite.busy,
                onClick() {
                  setInlineWrite((prev) => ({ ...prev, text: '1' }))
                },
              },
              '开',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm' + (inlineWrite.text === '0' ? ' is-on' : ''),
                disabled: inlineWrite.busy,
                onClick() {
                  setInlineWrite((prev) => ({ ...prev, text: '0' }))
                },
              },
              '关',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                disabled: inlineWrite.busy,
                onClick() {
                  submitWriteCell(inlineWrite.text === '1')
                },
              },
              '确认',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                disabled: inlineWrite.busy,
                onClick() {
                  setInlineWrite(null)
                },
              },
              '取消',
            ),
          )
        : el(
            'span',
            { className: 'dvb-actions', style: { gap: '4px' } },
            el('input', {
              className: 'dvb-input dvb-input-mono',
              value: inlineWrite.text,
              type: 'text',
              disabled: inlineWrite.busy,
              onChange: (event) => {
                setInlineWrite((prev) => ({ ...prev, text: event.target.value }))
              },
              onKeyDown: (event) => {
                if (event.key === 'Enter') submitWriteCell()
              },
            }),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                disabled: inlineWrite.busy || !inlineWrite.text.trim(),
                onClick() {
                  submitWriteCell()
                },
              },
              '确定',
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                disabled: inlineWrite.busy,
                onClick() {
                  setInlineWrite(null)
                },
              },
              '取消',
            ),
          ),
      inlineWrite.busy
        ? el('span', { className: 'dvb-hint' }, t('writing') || '写入中…')
        : inlineWrite.result
          ? el(
              'span',
              { className: 'dvb-hint ' + (inlineWrite.result.ok === false ? 'dvb-need' : '') },
              inlineWrite.result.ok === false
                ? inlineWrite.result.error || '写入失败'
                : inlineWrite.result.unknown
                  ? t('writeUnknown') || '结果未知'
                  : t('writeDone') || '写入成功',
            )
          : null,
    )
  }
  if (!writable) {
    return el(
      'span',
      {
        className: 'dvb-val dvb-cell-value dvb-cell-readonly',
        title: '只读点位，不可写入',
        style: {
          display: 'inline-block',
          cursor: 'default',
          font: 'inherit',
          fontWeight: 600,
          color: 'var(--dsw-alias-label-primary, inherit)',
        },
      },
      String(shown),
    )
  }
  return el(
    'button',
    {
      type: 'button',
      className: 'dvb-val dvb-cell-value dvb-cell-writable',
      disabled: !!busy || writeRunning,
      title: '点击写入当前值',
      style: {
        padding: 0,
        border: 'none',
        background: 'none',
        cursor: 'pointer',
        font: 'inherit',
        fontWeight: 600,
        color: 'var(--dsw-alias-label-primary, inherit)',
      },
      onClick() {
        openWriteCell(point)
      },
    },
    String(shown),
  )
}
