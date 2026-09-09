/**
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createKeilPickerDialog(React, t) {
  const el = React.createElement
  return function KeilPickerDialog(props) {
    const { picker, busy, openPicker, chooseProject, onClose } = props
    if (!picker) return null

    return el(
      'div',
      {
        className: 'dvb-mask',
        onClick() {
          onClose()
        },
      },
      el(
        'div',
        {
          className: 'dvb-picker',
          onClick(event) {
            event.stopPropagation()
          },
        },
        el(
          'div',
          { className: 'dvb-picker-head' },
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn',
              disabled: !picker.parent || !!busy,
              onClick() {
                openPicker(picker.parent)
              },
            },
            t('pickerUp'),
          ),
          el('div', { className: 'dvb-hint' }, picker.path),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn',
              onClick() {
                onClose()
              },
            },
            t('pickerClose'),
          ),
        ),
        (picker.dirs || []).map((item) =>
          el(
            'button',
            {
              key: `d-${item.path}`,
              type: 'button',
              className: 'dvb-picker-row',
              onClick() {
                openPicker(item.path)
              },
            },
            `▸ ${item.name}`,
          ),
        ),
        (picker.files || []).map((item) =>
          el(
            'button',
            {
              key: `f-${item.path}`,
              type: 'button',
              className: 'dvb-picker-row dvb-picker-file',
              onClick() {
                chooseProject(item.path)
              },
            },
            item.name,
          ),
        ),
        (!picker.dirs || !picker.dirs.length) && (!picker.files || !picker.files.length)
          ? el('div', { className: 'dvb-hint' }, t('pickerEmpty'))
          : null,
      ),
    )
  }
}
