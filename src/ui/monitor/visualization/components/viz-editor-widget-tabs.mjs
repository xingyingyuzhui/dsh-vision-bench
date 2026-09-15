// Value/switch widget config tabs and sample previews for the editor drawer.

import { renderSwitchWidget } from '../renderers/switch-renderer.mjs'
import { renderValueWidget } from '../renderers/value-renderer.mjs'
import { DEC_OPTS, P } from './viz-editor-constants.mjs'

export function createWidgetTabRenderers(el) {
  function renderValueTabContent(fields, activeTab) {
    const { sec, rowInp, rowNum, rowSel, rowPills, rowColor, rowSwitch } = fields
    return activeTab === 'format'
      ? [
          sec('占位与前后缀'),
          rowInp('无数据占位', 'emptyText', '—', '', 2),
          rowInp('前缀', 'valuePrefix', '', '', 2),
          rowInp('后缀', 'valueSuffix', '', '', 2),
        ]
      : activeTab === 'status'
        ? [
            sec('状态规则'),
            rowSwitch('showStatus', '显示状态', true, 4),
            rowNum('告警下限', 'statusLo', '低于则告警'),
            rowNum('告警上限', 'statusHi', '高于则告警'),
            el('div', { key: 'h', className: 'dvb-hint dvb-viz-span-4' }, '不填则仅按点位通讯是否正常判断。'),
          ]
        : [
            sec('基础内容'),
            rowSwitch('showTitle', '显示标题'),
            rowInp('单位', 'yUnit', '℃, rpm'),
            rowSel('小数位数', 'valueDecimals', DEC_OPTS),
            sec('数值样式'),
            rowSel('数值字号', 'valueSize', P('32:32 px,40:40 px,48:48 px,56:56 px')),
            rowColor('数值颜色', 'valueColor', '#172033'),
            rowPills('内容对齐', 'valueAlign', P('left:左对齐,center:居中'), 'left', 2),
            rowPills('单位位置', 'unitPos', P('right:数值右侧,below:数值下方'), 'right', 2),
            sec('辅助信息'),
            rowSwitch('showStatus', '显示状态'),
            rowSwitch('showUpdatedAt', '显示更新时间'),
            sec('卡片外观'),
            rowColor('背景颜色', 'cardBg', '#FFFFFF'),
            rowSwitch('cardBorder', '边框', true),
            rowSel('圆角', 'cardRadius', P('8:8 px,12:12 px,16:16 px')),
          ]
  }

  function renderSwitchTabContent(fields, activeTab) {
    const { sec, rowInp, rowPills, rowColor, rowSwitch, rowSel } = fields
    return activeTab === 'behavior'
      ? [
          sec('控制行为'),
          rowSwitch('confirmWrite', '写入前二次确认', true, 4),
          el('div', { key: 'h', className: 'dvb-hint dvb-viz-span-4' }, 'Agent 或界面写线圈前弹出确认卡。'),
        ]
      : activeTab === 'feedback'
        ? [
            sec('状态反馈'),
            rowSwitch('showFeedback', '显示反馈状态', true, 4),
            rowSwitch('showUpdatedAt', '显示更新时间', true, 4),
            rowInp('提示文案', 'hintText', '实际状态以设备反馈为准。', '', 4),
            el('div', { key: 'h', className: 'dvb-hint dvb-viz-span-4' }, '执行中：等待设备回读。离线：开关禁用，保留上次状态。'),
          ]
        : [
            sec('基础内容'),
            rowSwitch('showTitle', '显示标题', true, 4),
            sec('控件样式'),
            rowPills('展示形式', 'switchStyle', P('toggle:滑动开关,buttons:双按钮'), 'toggle', 4),
            rowPills('控件尺寸', 'switchSize', P('sm:小,md:中,lg:大'), 'md', 4),
            sec('状态文案'),
            rowInp('开启文案', 'onLabel', '已开启'),
            rowInp('关闭文案', 'offLabel', '已关闭'),
            sec('状态颜色'),
            rowColor('开启颜色', 'onColor', '#4D85FF'),
            rowColor('关闭颜色', 'offColor', '#B8C0CC'),
            sec('卡片外观'),
            rowColor('背景颜色', 'cardBg', '#FFFFFF'),
            rowSwitch('cardBorder', '边框', true),
            rowSel('圆角', 'cardRadius', P('8:8 px,12:12 px,16:16 px')),
          ]
  }

  function valuePreview(s, editorName) {
    return [
      el(
        'div',
        { key: 'ph', className: 'dvb-viz-preview-head' },
        el('span', { className: 'dvb-viz-preview-title' }, '实时预览'),
        el('span', { className: 'dvb-badge' }, '示例数据'),
      ),
      el(
        'div',
        { key: 'live' },
        renderValueWidget(el, {
          settings: s,
          name: editorName || '设备温度',
          value: 26.8,
          ok: true,
          unit: '℃',
          at: Date.now(),
        }),
      ),
      el('div', { key: 'f', className: 'dvb-viz-preview-foot' }, '当前预览使用示例数值，不读取现场点位。'),
      el('div', { key: 'eh', className: 'dvb-viz-preview-title' }, '无数据状态'),
      el(
        'div',
        { key: 'empty' },
        renderValueWidget(el, {
          settings: s,
          name: editorName || '设备温度',
          empty: true,
          ok: false,
        }),
      ),
    ]
  }

  function switchPreview(fields, s, editorName, previewState, setPreviewState) {
    const { pill } = fields
    const st = previewState
    return [
      el(
        'div',
        { key: 'ph', className: 'dvb-viz-preview-head' },
        el('span', { className: 'dvb-viz-preview-title' }, '实时预览'),
        el('span', { className: 'dvb-badge' }, '模拟状态'),
      ),
      el(
        'div',
        { key: 'states', className: 'dvb-viz-filter-pills' },
        [['on', '已开启'], ['off', '已关闭'], ['busy', '执行中'], ['offline', '离线']].map(([k, lbl]) =>
          pill(st === k, () => setPreviewState(k), lbl, k),
        ),
      ),
      el(
        'div',
        { key: 'sw' },
        renderSwitchWidget(el, {
          settings: s,
          name: editorName || '风机开关',
          on: st === 'on' || st === 'busy',
          busy: st === 'busy',
          offline: st === 'offline',
          at: Date.now(),
          onToggle() {
            setPreviewState((p) => (p === 'on' ? 'off' : 'on'))
          },
        }),
      ),
      el('div', { key: 'f', className: 'dvb-viz-preview-foot' }, '预览仅模拟外观，不向设备发送指令。'),
    ]
  }

  function configShell(fields, activeTab, setActiveTab, tabs, form, preview) {
    const { pill } = fields
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
        el('div', { className: 'dvb-viz-config-form' }, el('div', { className: 'dvb-viz-config-grid' }, form)),
        el('div', { className: 'dvb-viz-preview-panel' }, preview),
      ),
    ]
  }

  return {
    renderValueTabContent,
    renderSwitchTabContent,
    valuePreview,
    switchPreview,
    configShell,
  }
}
