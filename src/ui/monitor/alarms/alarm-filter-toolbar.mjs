import { getCustomSelect } from '../../components/custom-select.mjs'

const SEL = { width: '112px', minWidth: '96px', flex: 'none' }
const TIME_SEL = { width: '100px', minWidth: '90px', flex: 'none' }

export function createAlarmFilterToolbar(React, t) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)

  const TYPE_OPTIONS = [
    { value: 'all', label: '全部类型' },
    { value: 'process', label: '过程' },
    { value: 'comm', label: '通信' },
  ]

  const SEVERITY_OPTIONS = [
    { value: 'all', label: '全部级别' },
    { value: 'critical', label: '严重' },
    { value: 'warn', label: '警告' },
  ]

  const TIME_OPTIONS = [
    { value: 'today', label: '今天' },
    { value: '7d', label: '近7天' },
    { value: 'all', label: '全部时间' },
  ]

  return function AlarmFilterToolbar(props) {
    const {
      type = 'all',
      onTypeChange,
      severity = 'all',
      onSeverityChange,
      time = 'today',
      onTimeChange,
      search = '',
      onSearchChange,
      onReset,
    } = props

    return el(
      'div',
      { className: 'dvb-filter-toolbar dvb-alarm-toolbar' },
      el(
        'div',
        { className: 'dvb-filter-item' },
        el('span', { className: 'dvb-filter-label' }, '类型'),
        el(CustomSelect, {
          style: SEL,
          value: type,
          options: TYPE_OPTIONS,
          onChange: onTypeChange,
          className: 'dvb-select-type',
        }),
      ),
      el(
        'div',
        { className: 'dvb-filter-item' },
        el('span', { className: 'dvb-filter-label' }, '级别'),
        el(CustomSelect, {
          style: SEL,
          value: severity,
          options: SEVERITY_OPTIONS,
          onChange: onSeverityChange,
          className: 'dvb-select-severity',
        }),
      ),
      el(
        'div',
        { className: 'dvb-filter-item' },
        el('span', { className: 'dvb-filter-label' }, '时间'),
        el(CustomSelect, {
          style: TIME_SEL,
          value: time,
          options: TIME_OPTIONS,
          onChange: onTimeChange,
          className: 'dvb-select-time',
        }),
      ),
      el(
        'div',
        { className: 'dvb-search-box' },
        el(
          'svg',
          {
            className: 'dvb-search-icon',
            viewBox: '0 0 24 24',
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
          },
          el('circle', { cx: 11, cy: 11, r: 8 }),
          el('line', { x1: 21, y1: 21, x2: 16.65, y2: 16.65 }),
        ),
        el('input', {
          type: 'text',
          className: 'dvb-input dvb-search-input',
          placeholder: '搜索设备、点位或告警',
          value: search,
          onChange(e) {
            if (typeof onSearchChange === 'function') onSearchChange(e.target.value)
          },
        }),
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-reset',
          onClick() {
            if (typeof onReset === 'function') onReset()
          },
        },
        el(
          'svg',
          {
            viewBox: '0 0 24 24',
            width: 13,
            height: 13,
            fill: 'none',
            stroke: 'currentColor',
            strokeWidth: 2,
            strokeLinecap: 'round',
            strokeLinejoin: 'round',
            style: { marginRight: 4, flex: 'none' },
          },
          el('polygon', { points: '22 3 2 3 10 12.46 10 19 14 21 14 12.46 22 3' }),
        ),
        '重置',
      ),
    )
  }
}
