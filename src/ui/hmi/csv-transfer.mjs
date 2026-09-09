import { renderSaveCancelGroup } from '../components/save-cancel-buttons.mjs'

/** CSV import panel scoped to one device. */
export function renderCsvPanel(el, t, ctx) {
  const { d, csvTarget, setCsvTarget, csvText, setCsvText, importCsv } = ctx
  return el(
    'div',
    { className: 'dvb-write-panel' },
    el(
      'div',
      { className: 'dvb-hint' },
      'CSV 只作用于设备 ' +
        d.name +
        ' · 站号 ' +
        d.unitId +
        '：' +
        (csvTarget.mode === 'replace' ? '替换该设备点位' : '合并导入'),
    ),
    el(
      'div',
      { className: 'dvb-actions' },
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn' + (csvTarget.mode !== 'replace' ? ' dvb-btn-primary' : ''),
          onClick() {
            setCsvTarget((p) => ({ ...p, mode: 'merge' }))
          },
        },
        '合并导入',
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn' + (csvTarget.mode === 'replace' ? ' dvb-btn-primary' : ''),
          onClick() {
            setCsvTarget((p) => ({ ...p, mode: 'replace' }))
          },
        },
        '替换当前设备点位',
      ),
    ),
    el('textarea', {
      className: 'dvb-input dvb-csv-area',
      value: csvText,
      rows: 5,
      spellCheck: false,
      placeholder: 'name,function,address,scale,offset,unit,alarmMin,alarmMax,trendEnabled',
      onChange: (event) => {
        setCsvText(event.target.value)
      },
    }),
    renderSaveCancelGroup(el, t, {
      onCancel() {
        setCsvTarget((p) => ({ ...p, open: false }))
      },
      onSave: importCsv,
      saveText: t('csvApply') || '确认导入',
      cancelText: t('csvCancel') || '取消',
      saveDisabled: !csvText.trim(),
      size: 'sm',
      gap: 8,
    }),
  )
}
