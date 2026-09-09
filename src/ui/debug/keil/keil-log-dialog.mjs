import { getCustomSelect } from '../../components/custom-select.mjs'

/**
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createKeilLogDialog(React, t) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)

  return function KeilLogDialog(props) {
    const { logView, setLogView } = props
    if (!logView?.open) return null

    return el(
      'div',
      { className: 'dvb-panel dvb-write-panel' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, '完整日志'),
        el('input', {
          className: 'dvb-input dvb-map-search',
          placeholder: '搜索…',
          value: logView.search,
          onChange: (event) => {
            setLogView((prev) => ({ ...prev, search: event.target.value }))
          },
        }),
        el(CustomSelect, {
          style: { width: '96px', flex: 'none' },
          value: logView.filter,
          options: [
            { value: 'all', label: '全部' },
            { value: 'error', label: '仅错误' },
            { value: 'warning', label: '仅警告' },
          ],
          onChange(val) {
            const filter = val?.target ? val.target.value : val
            setLogView((prev) => ({ ...prev, filter }))
          },
        }),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            onClick() {
              if (
                logView.text &&
                typeof navigator !== 'undefined' &&
                navigator.clipboard &&
                navigator.clipboard.writeText
              )
                navigator.clipboard.writeText(logView.text)
            },
          },
          '复制',
        ),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn',
            onClick() {
              setLogView((prev) => ({ ...prev, open: false }))
            },
          },
          t('csvCancel'),
        ),
      ),
      logView.busy
        ? el('div', { className: 'dvb-hint' }, t('opening'))
        : logView.error
          ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, logView.error)
          : el(
              'pre',
              { className: 'dvb-log' },
              (logView.text || '')
                .split('\n')
                .filter((line) => {
                  if (logView.filter === 'error') return /error/i.test(line)
                  if (logView.filter === 'warning') return /warning/i.test(line)
                  return true
                })
                .filter((line) => {
                  const s = logView.search.trim().toLowerCase()
                  return !s || line.toLowerCase().includes(s)
                })
                .join('\n'),
            ),
    )
  }
}
