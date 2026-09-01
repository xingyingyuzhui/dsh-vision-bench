/** Add/edit device form panel. */
export function renderDeviceForm(el, t, ctx) {
  const { field, devForm, setDevForm, activeConnId, activeConnObj, cwd, saveDeviceForm } = ctx
  if (!(devForm.open && activeConnId && devForm.connectionId === activeConnId)) return null
  return el(
    'div',
    { className: 'dvb-panel dvb-write-panel' },
    el(
      'div',
      { className: 'dvb-panel-head' },
      el(
        'span',
        { className: 'dvb-panel-title' },
        (devForm.id ? t('devEdit') || '编辑设备' : t('devAdd') || '添加设备') +
          ' · ' +
          (activeConnObj ? activeConnObj.name : ''),
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn',
          onClick() {
            setDevForm((p) => ({ ...p, open: false }))
          },
        },
        t('csvCancel'),
      ),
    ),
    el(
      'div',
      { className: 'dvb-toolbar' },
      field(
        '设备名称',
        el('input', {
          className: 'dvb-input',
          value: devForm.name,
          placeholder: '如 温度传感器',
          onChange: (e) => {
            setDevForm((p) => ({ ...p, name: e.target.value }))
          },
        }),
      ),
      field(
        t('unitId') || '站号',
        el('input', {
          className: 'dvb-input dvb-input-mono',
          type: 'number',
          min: 0,
          max: 247,
          value: String(devForm.unitId),
          onChange: (e) => {
            setDevForm((p) => ({ ...p, unitId: Number(e.target.value) }))
          },
        }),
      ),
      el(
        'button',
        { type: 'button', className: 'dvb-btn dvb-btn-primary', disabled: !cwd, onClick: saveDeviceForm },
        t('savePoint') || '保存',
      ),
    ),
  )
}
