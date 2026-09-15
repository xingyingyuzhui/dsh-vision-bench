// Chart-type (line/bar) config tabs and live preview shell for the editor drawer.

import { DEC_OPTS, P, POS_OPTS, SIZES, TIME_WINDOWS } from './viz-editor-constants.mjs'

export function renderChartStyleTab(fields, isLine) {
  const { sec, rowPills, rowSel, rowColor, rowSwitch } = fields
  return isLine
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
}

export function renderChartXTab(fields, s) {
  const { sec, rowPills, rowSel, rowSwitch, rowNum, rowInp, rowColor } = fields
  return [
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
}

export function renderChartYTab(fields, s) {
  const { sec, rowPills, rowSel, rowSwitch, rowNum, rowInp, rowColor } = fields
  return [
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
}

export function renderChartLegendTab(fields, s) {
  const { sec, rowPills, rowSel, rowSwitch } = fields
  return [
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
}

export function renderChartConfigContent({ el, fields, activeTab, setActiveTab, previewRef, s, isLine }) {
  const { pill } = fields
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
          activeTab === 'style'
            ? renderChartStyleTab(fields, isLine)
            : activeTab === 'x'
              ? renderChartXTab(fields, s)
              : activeTab === 'y'
                ? renderChartYTab(fields, s)
                : renderChartLegendTab(fields, s),
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
            ? s.xScaleType === 'count'
              ? '点序号 · 10个采样点'
              : `时间轴 · 最近 ${TIME_WINDOWS.find(([v]) => v === String(s.windowMs))?.[1] || '5分钟'}`
            : '4 分类',
        ),
      ),
    ),
  ]
}
