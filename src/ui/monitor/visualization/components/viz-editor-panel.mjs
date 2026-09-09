// TaskP2/0.20.0: 可视化组件编辑/新建抽屉 VizEditorPanel
// 现代化右侧滑出抽屉形态：组件名称、可视化类型卡片、4-Tab 高级图表配置、实时预览及关联点位选择。

import { getCustomSelect } from '../../../components/custom-select.mjs'
import { renderPreviewChart } from '../hooks/use-viz-charts.mjs'
import { pointCompatible } from '../viz-helpers.mjs'
import { createVizPointPicker } from './viz-point-picker.mjs'

const P = (s) => s.split(',').map((x) => x.split(':'))
const SIZES = P('11:11 px,12:12 px,14:14 px')
const POS_OPTS = P('top:顶部,bottom:底部,left:左侧,right:右侧')
const DEC_OPTS = P(':自动,0:0位,1:1位,2:2位,3:3位')
const TIME_WINDOWS = P('60000:1分钟,300000:5分钟,900000:15分钟,1800000:30分钟,3600000:1小时')
const TYPE_DEFS = P('line:折线图:时序趋势,bar:柱状图:瞬时对比,value:数值卡:实时数值,switch:控制开关:线圈控制')

export function createVizEditorPanel(React, t) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)
  const VizPointPicker = createVizPointPicker(React, t)

  return function VizEditorPanel({
    editor,
    setEditor,
    points = [],
    devices = [],
    connections = [],
    pointOptions = [],
    editorCheck = { ok: false, reason: '' },
    saving = false,
    vizReadOnly = false,
    onSave,
    onCancel,
  }) {
    const [activeTab, setActiveTab] = React.useState('style')
    const previewRef = React.useRef(null)

    React.useEffect(() => {
      const onKey = (e) => { if (e.key === 'Escape') { e.stopPropagation(); onCancel?.() } }
      window.addEventListener('keydown', onKey)
      return () => window.removeEventListener('keydown', onKey)
    }, [onCancel])

    React.useEffect(() => {
      renderPreviewChart(previewRef.current, editor)
    }, [editor?.type, editor?.settings])

    if (!editor) return null

    const switchType = (type) =>
      setEditor((p) => ({
        ...p,
        type,
        pointIds: (type === 'value' || type === 'switch') && p.pointIds?.length > 1 ? p.pointIds.slice(0, 1) : p.pointIds,
      }))

    const s = editor.settings || {}
    const setS = (k, v) => setEditor((p) => ({ ...p, settings: { ...(p.settings || {}), [k]: v } }))

    const pill = (on, fn, txt, k = txt) =>
      el('button', { key: k, type: 'button', className: `dvb-viz-filter-pill${on ? ' is-active' : ''}`, onClick: fn }, txt)

    const sec = (lbl) => el('div', { key: lbl, className: 'dvb-viz-group-title dvb-viz-span-4' }, lbl)

    const grp = (k, lbl, child, col = 2) =>
      el('div', { key: k, className: `dvb-viz-form-group dvb-viz-span-${col}` }, el('label', { className: 'dvb-viz-sublabel' }, lbl), child)

    const inp = (k, ph = '', type = 'text') =>
      el('input', { className: 'dvb-input', type, placeholder: ph, value: s[k] ?? '', onChange: (e) => setS(k, e.target.value) })

    const rowInp = (lbl, k, ph, type, col = 2) => grp(k, lbl, inp(k, ph, type), col)
    const rowNum = (lbl, k, ph) => rowInp(lbl, k, ph, 'number')

    const rowSel = (lbl, k, opts, col = 2) =>
      grp(
        k,
        lbl,
        el(CustomSelect, {
          value: String(s[k] ?? opts[0][0]),
          onChange: (val) => setS(k, val),
          options: opts.map(([v, n]) => ({ value: String(v), label: n })),
        }),
        col,
      )

    const rowPills = (lbl, k, opts, def, col = 4) =>
      grp(k, lbl, el('div', { className: 'dvb-viz-filter-pills' }, opts.map(([v, n]) => pill((s[k] ?? def) === v, () => setS(k, v), n, String(v)))), col)

    const rowColor = (lbl, k, def = '#94A3B8') => {
      const v = s[k] || def
      return grp(k, lbl, el('div', { className: 'dvb-viz-color-row' },
        el('input', { type: 'color', className: 'dvb-viz-color-swatch', value: v[0] === '#' && v.length === 7 ? v : def, onChange: (e) => setS(k, e.target.value) }),
        inp(k, def),
      ))
    }

    const rowSwitch = (k, lbl, def = true, col = 2) => {
      const on = def ? s[k] !== false : !!s[k]
      return el('div', { key: k, className: `dvb-viz-switch-row dvb-viz-span-${col}` },
        el('button', { type: 'button', role: 'switch', 'aria-checked': on, className: 'dvb-viz-opt-btn', onClick: () => setS(k, !on) },
          el('span', { className: `dvb-switch${on ? ' is-on' : ''}` }, el('span', { className: 'dvb-switch-track' })),
          lbl,
        ),
      )
    }

    const isLine = editor.type === 'line'
    const isBar = editor.type === 'bar'
    const isChart = isLine || isBar

    const renderStyleTab = () =>
      isLine
        ? [
            sec('曲线设置'),
            rowPills('连线方式', 'lineStyle', P('linear:折线,smooth:平滑,step:阶梯'), 'smooth'),
            rowSel('线宽', 'lineWidth', P('1:1 px,2:2 px,3:3 px,4:4 px')),
            rowColor('曲线颜色', 'lineColor', '#4D85FF'),
            rowSwitch('showSymbol', '数据点标记'),
            rowSwitch('area', '面积填充', false),
            sec('网格线'),
            rowSwitch('yShowGrid', '横向网格'),
            rowSwitch('xShowGrid', '纵向网格'),
            rowSel('线型', 'gridLineType', P('dashed:虚线,solid:实线,dotted:点线')),
            rowColor('格线颜色', 'gridColor', '#E8EDF5'),
          ]
        : [
            sec('排列与方向'),
            rowPills('柱形方向', 'barHorizontal', [[false, '纵向'], [true, '横向']], false, 2),
            rowPills('排列方式', 'barStack', [[false, '分组'], [true, '堆叠']], false, 2),
            sec('柱形样式'),
            rowSel('柱宽', 'barWidth', P(':自动,16:16 px,24:24 px,32:32 px')),
            rowSel('圆角', 'barRadius', P('0:0 px,4:4 px,8:8 px')),
            sec('数值标签'),
            rowSwitch('showBarLabel', '显示标签', true, 4),
            rowSel('标签位置', 'barLabelPos', P('top:柱顶,inside:内部')),
            rowSel('小数位数', 'barLabelDecimals', DEC_OPTS.slice(1)),
            sec('网格线'),
            rowSwitch('showGrid', '显示网格线', true, 4),
          ]

    const renderXTab = () => [
      sec('范围'),
      rowPills('轴类型', 'xScaleType', P('time:时间,count:点序号'), 'time', 2),
      s.xScaleType !== 'count' && rowSel('显示范围', 'windowMs', TIME_WINDOWS, 2),
      rowSwitch('xAutoScroll', '自动滚动', true, 4),
      sec('刻度'),
      rowPills('主刻度模式', 'xSplitMode', P('auto:自动,custom:自定义'), 'auto', 4),
      s.xSplitMode === 'custom' && [rowNum('主刻度等分', 'xSplitNumber', '5'), rowNum('主刻度长度', 'xTickLength', '5')],
      rowSwitch('xMinorTick', '次刻度', false, 4),
      s.xMinorTick && [rowNum('等分数', 'xMinorSplit', '2'), rowNum('刻度长度', 'xMinorLength', '3')],
      sec('标签与轴线'),
      rowSwitch('xShowLabel', '刻度标签', true, 4),
      rowSel('标签字号', 'xLabelSize', SIZES, 2),
      rowSel('标签方向', 'xLabelRotate', P('0:水平,45:倾斜 45°,90:垂直'), 2),
      rowInp('轴标题', 'xTitle', '时间'),
      rowColor('轴线颜色', 'xAxisColor'),
    ]

    const renderYTab = () => [
      sec('数值范围'),
      rowPills('范围模式', 'yRangeMode', P('auto:自动,manual:手动'), 'auto', 4),
      s.yRangeMode === 'manual' && [rowNum('最小值', 'yMin', '0'), rowNum('最大值', 'yMax', '100')],
      rowSel('刻度类型', 'yScaleType', P('value:线性,log:对数'), 4),
      sec('刻度'),
      rowInp('主刻度间隔', 'yInterval', '自动', 'number', 4),
      rowSwitch('yMinorTick', '次刻度', false, 4),
      s.yMinorTick && [rowNum('等分数', 'yMinorSplit', '2'), rowNum('刻度长度', 'yMinorLength', '3')],
      sec('标签与单位'),
      rowSwitch('yShowLabel', '刻度标签', true, 4),
      rowSel('小数位数', 'yDecimals', DEC_OPTS),
      rowSel('字号', 'yLabelSize', SIZES),
      rowInp('单位', 'yUnit', '℃, %'),
      rowInp('轴标题', 'yTitle', '温度'),
      sec('轴线'),
      rowPills('轴位置', 'yPosition', P('left:左侧,right:右侧'), 'left', 2),
      rowColor('轴线颜色', 'yAxisColor'),
    ]

    const renderLegendTab = () => [
      sec('图例'),
      rowSwitch('showLegend', '显示图例', true, 4),
      s.showLegend !== false && [
        rowPills('图例位置', 'legendPos', POS_OPTS, 'top', 4),
        rowSel('字号', 'legendSize', SIZES),
        rowSwitch('legendSelect', '切换系列'),
      ],
      sec('悬浮提示'),
      rowSwitch('showTooltip', '显示悬浮提示', true, 4),
      s.showTooltip !== false && [
        rowPills('提示方式', 'tooltipTrigger', P('item:单点,axis:同一时刻'), 'axis'),
        rowSel('指示线', 'tooltipAxisPointer', P('cross:十字线,line:直线,none:无')),
      ],
      sec('缩放与平移'),
      rowSwitch('zoomScroll', '滚轮缩放', false),
      s.zoomScroll && rowPills('方向', 'zoomAxis', P('x:X 轴,y:Y 轴,xy:双轴'), 'x'),
      rowSwitch('zoomDrag', '拖拽平移', false, 4),
    ]

    const renderConfigContent = () => {
      if (isChart) {
        const tabs = [['style', '样式'], ['x', isLine ? 'X轴' : '分类轴'], ['y', isLine ? 'Y轴' : '数值轴'], ['legend', '图例与交互']]
        return [
          el(
            'div',
            { key: 'top_bar', className: 'dvb-viz-tabs-bar' },
            el(
              'div',
              { className: 'dvb-viz-filter-pills' },
              tabs.map(([k, lbl]) => pill(activeTab === k, () => setActiveTab(k), lbl, k)),
            ),
          ),
          el(
            'div',
            { key: 'split', className: 'dvb-viz-config-split' },
            el(
              'div',
              { className: 'dvb-viz-config-form' },
              el(
                'div',
                { className: 'dvb-viz-config-grid' },
                activeTab === 'style' ? renderStyleTab() :
                activeTab === 'x' ? renderXTab() :
                activeTab === 'y' ? renderYTab() :
                renderLegendTab(),
              ),
            ),
            el(
              'div',
              { className: 'dvb-viz-preview-panel' },
              el(
                'div',
                { className: 'dvb-viz-preview-head' },
                el('span', { className: 'dvb-viz-preview-title' }, '实时预览'),
                el('span', { className: 'dvb-badge' }, '示例数据'),
              ),
              el('div', { ref: previewRef, className: 'dvb-viz-preview-box' }),
              el(
                'div',
                { className: 'dvb-viz-preview-foot' },
                isLine
                  ? (s.xScaleType === 'count'
                      ? '点序号 · 10个采样点'
                      : `时间轴 · 最近 ${TIME_WINDOWS.find(([v]) => v === String(s.windowMs))?.[1] || '5分钟'}`)
                  : '4 分类',
              ),
            ),
          ),
        ]
      }
      if (editor.type === 'value') {
        return [
          rowInp('显示单位', 'yUnit', 'rpm, ℃', '', 4),
          el('div', { key: 'h', className: 'dvb-hint' }, '单点实时监控'),
        ]
      }
      if (editor.type === 'switch') {
        return [
          rowSwitch('confirmWrite', '写入前二次确认', false, 4),
          el('div', { key: 'h', className: 'dvb-hint' }, 'Modbus 01 控制'),
        ]
      }
      return null
    }

    const modalTitle = editor.id ? t('vizEdit') || '编辑组件' : t('vizNew') || '新建组件'

    return el(
      'div',
      {
        className: 'dvb-mask dvb-viz-modal-mask',
        onClick(e) {
          if (e.target === e.currentTarget && !saving) onCancel?.()
        },
      },
      el(
        'div',
        {
          className: 'dvb-viz-modal',
          role: 'dialog',
          'aria-modal': 'true',
          'aria-label': modalTitle,
        },
        el(
          'div',
          { className: 'dvb-viz-drawer-head' },
          el('div', { className: 'dvb-viz-drawer-title' }, modalTitle),
          el('button', { type: 'button', className: 'dvb-viz-drawer-close', 'aria-label': '关闭', disabled: saving, onClick: () => onCancel?.() }, '✕'),
        ),
        el(
          'div',
          { className: 'dvb-viz-drawer-body' },
          // 1. 组件名称
          el(
            'div',
            { className: 'dvb-viz-form-section' },
            el('label', { className: 'dvb-viz-form-label' }, t('vizName') || '组件名称'),
            el('input', {
              className: 'dvb-input dvb-viz-input',
              placeholder: t('vizNamePh') || '如：主电机转速',
              value: editor.name || '',
              maxLength: 40,
              onChange: (e) => setEditor((p) => ({ ...p, name: e.target.value })),
            }),
          ),
          // 2. 类型与配置
          el(
            'div',
            { className: 'dvb-viz-form-section' },
            el('label', { className: 'dvb-viz-form-label' }, '组件类型与配置'),
            el(
              'div',
              { className: 'dvb-viz-type-split' },
              el(
                'div',
                { className: 'dvb-viz-type-col' },
                TYPE_DEFS.map(([ty, title, desc]) =>
                  el(
                    'button',
                    {
                      key: ty,
                      type: 'button',
                      className: `dvb-viz-type-card${editor.type === ty ? ' is-active' : ''}`,
                      onClick: () => switchType(ty),
                    },
                    el('span', { className: 'dvb-viz-type-title' }, title),
                    el('span', { className: 'dvb-viz-type-desc' }, desc),
                  ),
                ),
                el(
                  'select',
                  {
                    value: editor.type,
                    onChange: (e) => switchType(e.target.value),
                    style: { display: 'none' },
                  },
                  TYPE_DEFS.map(([ty, title]) => el('option', { key: ty, value: ty }, title)),
                ),
              ),
              el('div', { className: 'dvb-viz-config-card' }, renderConfigContent()),
            ),
          ),
          // 3. 关联监控点位
          el(VizPointPicker, {
            editor,
            setEditor,
            pointOptions,
            points,
            devices,
            connections,
          }),
          !editorCheck.ok && editorCheck.reason && el('div', { className: 'dvb-hint dvb-need' }, editorCheck.reason),
        ),
        el(
          'div',
          { className: 'dvb-viz-drawer-footer dvb-dialog-footer' },
          el('button', { type: 'button', className: 'dvb-btn', disabled: saving, onClick: onCancel }, t('csvCancel') || '取消'),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-primary',
              disabled: saving || !editorCheck.ok || vizReadOnly,
              onClick: onSave,
            },
            saving ? (t('saving') || '保存中…') : (t('vizSave') || '保存'),
          ),
        ),
      ),
    )
  }
}
