import { getCustomSelect } from '../../components/custom-select.mjs'
import { renderFilterItem, renderFilterToolbar } from '../../patterns/filter-toolbar.mjs'

const SEL = { width: '112px', minWidth: '96px', flex: 'none' }
const TIME_SEL = { width: '100px', minWidth: '90px', flex: 'none' }

export function createJournalFilterToolbar(React, t) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)

  const SOURCE_OPTIONS = [
    { value: 'all', label: '全部来源' },
    { value: 'user', label: '用户' },
    { value: 'agent', label: 'Agent' },
    { value: 'system', label: '系统' },
  ]

  const RESULT_OPTIONS = [
    { value: 'all', label: '全部结果' },
    { value: 'success', label: '成功' },
    { value: 'fail', label: '失败' },
  ]

  const TIME_OPTIONS = [
    { value: 'today', label: '今天' },
    { value: '7d', label: '近7天' },
    { value: 'all', label: '全部时间' },
  ]

  return function JournalFilterToolbar(props) {
    const {
      source = 'all',
      onSourceChange,
      result = 'all',
      onResultChange,
      time = 'today',
      onTimeChange,
      search = '',
      onSearchChange,
      onReset,
    } = props

    return renderFilterToolbar(el, {
      className: 'dvb-journal-toolbar',
      search,
      searchPlaceholder: '搜索操作、对象或任务',
      onSearchChange,
      onReset,
      filters: [
        renderFilterItem(el, {
          label: '来源',
          control: el(CustomSelect, {
            style: SEL,
            value: source,
            options: SOURCE_OPTIONS,
            onChange: onSourceChange,
            className: 'dvb-select-source',
          }),
        }),
        renderFilterItem(el, {
          label: '结果',
          control: el(CustomSelect, {
            style: SEL,
            value: result,
            options: RESULT_OPTIONS,
            onChange: onResultChange,
            className: 'dvb-select-result',
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
