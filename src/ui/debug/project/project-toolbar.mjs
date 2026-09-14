import { getCustomSelect } from '../../components/custom-select.mjs'
import { renderRefreshIcon } from './project-shared.mjs'

const REL_OPTS = [
  { value: 'call', label: '函数调用' },
  { value: 'include', label: 'include 依赖' },
]
const DEPTH_OPTS = ['1', '2', '3', 'all'].map((v) => ({ value: v, label: v === 'all' ? '全部' : `${v}层` }))
const FILTER_OPTS = ['all', 'missing', 'unread', 'outside'].map((v, i) => ({
  value: v,
  label: ['全部', '缺失', '不可读', '工作区外'][i],
}))
const optVal = (v) => (v?.target ? v.target.value : v)

export function createProjectToolbar(React) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)

  return function ProjectToolbar({
    viewMode,
    onViewMode,
    search,
    onSearch,
    searchRef,
    filter,
    onFilter,
    effectiveRelType,
    onRelType,
    graphDepth,
    onGraphDepth,
    keil,
    isDemo,
    busy,
    onReload,
    t,
    activeMapped,
    counts,
    graph,
    focusLabel,
  }) {
    return el(
      'div',
      { className: 'dvb-project-head' },
      el(
        'div',
        { className: 'dvb-project-subtoolbar' },
        el(
          'div',
          { className: 'dvb-project-subtoolbar-left' },
          el(
            'div',
            { className: 'dvb-project-view-toggle' },
            ['tree', 'graph'].map((m) =>
              el(
                'button',
                {
                  key: m,
                  type: 'button',
                  className: `dvb-btn dvb-btn-sm${viewMode === m ? ' is-on' : ''}`,
                  onClick: () => onViewMode(m),
                },
                m === 'tree' ? '树形' : '图谱',
              ),
            ),
          ),
          el('input', {
            ref: searchRef,
            className: 'dvb-input dvb-map-search',
            placeholder: '搜索文件或函数',
            value: search,
            onChange: (event) => onSearch(event.target.value),
          }),
        ),
        el(
          'div',
          { className: 'dvb-project-subtoolbar-right' },
          viewMode === 'graph'
            ? [
                el('span', { key: 'r', className: 'dvb-toolbar-label' }, '关系类型'),
                el(CustomSelect, {
                  key: 'R',
                  style: { width: '105px', flex: 'none' },
                  selectClassName: 'dvb-map-rel-type',
                  value: effectiveRelType,
                  options: REL_OPTS,
                  onChange: (val) => onRelType(optVal(val)),
                }),
                el('span', { key: 'd', className: 'dvb-toolbar-label' }, '展开层级'),
                el(CustomSelect, {
                  key: 'D',
                  style: { width: '85px', flex: 'none' },
                  selectClassName: 'dvb-map-depth',
                  value: graphDepth,
                  options: DEPTH_OPTS,
                  onChange: (val) => onGraphDepth(optVal(val)),
                }),
              ]
            : null,
          el(CustomSelect, {
            style: { width: '100px', flex: 'none', display: viewMode === 'tree' ? '' : 'none' },
            selectClassName: 'dvb-map-filter',
            value: filter,
            options: FILTER_OPTS,
            onChange: (val) => onFilter(optVal(val)),
          }),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm dvb-project-reload-btn',
              disabled: (!keil.project && !isDemo) || busy,
              onClick: onReload,
            },
            renderRefreshIcon(React, 13),
            el('span', { style: { marginLeft: '4px' } }, busy ? t('opening') : '重新加载'),
          ),
          el('span', { style: { display: 'none' } }, t('projectMap')),
          activeMapped && !isDemo
            ? el(
                'span',
                { style: { display: 'none' } },
                `${activeMapped.target || ''} · ${String(counts?.files || 0)} 文件 · ${String(graph?.edges?.length || 0)} 依赖`,
              )
            : null,
          focusLabel ? el('span', { style: { display: 'none' } }, focusLabel) : null,
        ),
      ),
    )
  }
}
