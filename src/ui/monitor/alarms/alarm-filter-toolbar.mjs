import { getCustomSelect } from '../../components/custom-select.mjs'
import { renderFilterItem, renderFilterToolbar } from '../../patterns/filter-toolbar.mjs'

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

    const resetIcon = el(
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
    )

    return renderFilterToolbar(el, {
      className: 'dvb-alarm-toolbar',
      search,
      searchPlaceholder: '搜索设备、点位或告警',
      onSearchChange,
      onReset,
      resetContent: [resetIcon, '重置'],
      filters: [
        renderFilterItem(el, {
          label: '类型',
          control: el(CustomSelect, {
            style: SEL,
            value: type,
            options: TYPE_OPTIONS,
            onChange: onTypeChange,
            className: 'dvb-select-type',
          }),
        }),
        renderFilterItem(el, {
          label: '级别',
          control: el(CustomSelect, {
            style: SEL,
            value: severity,
            options: SEVERITY_OPTIONS,
            onChange: onSeverityChange,
            className: 'dvb-select-severity',
          }),
        }),
        renderFilterItem(el, {
          label: '时间',
          control: el(CustomSelect, {
            style: TIME_SEL,
            value: time,
            options: TIME_OPTIONS,
            onChange: onTimeChange,
            className: 'dvb-select-time',
          }),
        }),
      ],
    })
  }
}
