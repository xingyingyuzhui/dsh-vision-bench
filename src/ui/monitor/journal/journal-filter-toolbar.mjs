import { getCustomSelect } from '../../components/custom-select.mjs'

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

    return el(
      'div',
      { className: 'dvb-filter-toolbar dvb-journal-toolbar' },
      el(
        'div',
        { className: 'dvb-filter-item' },
        el('span', { className: 'dvb-filter-label' }, '来源'),
        el(CustomSelect, {
          style: SEL,
          value: source,
          options: SOURCE_OPTIONS,
          onChange: onSourceChange,
          className: 'dvb-select-source',
        }),
      ),
      el(
        'div',
        { className: 'dvb-filter-item' },
        el('span', { className: 'dvb-filter-label' }, '结果'),
        el(CustomSelect, {
          style: SEL,
          value: result,
          options: RESULT_OPTIONS,
          onChange: onResultChange,
          className: 'dvb-select-result',
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
          placeholder: '搜索操作、对象或任务',
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
        '重置',
      ),
    )
  }
}
