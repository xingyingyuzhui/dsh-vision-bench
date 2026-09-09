// TaskP2/0.20.0: 可视化空状态引导组件 VizEmptyState
// 当未配置任何组件且未打开编辑器时展示引导信息。

export function createVizEmptyState(React, t) {
  const el = React.createElement

  return function VizEmptyState({ cwd = '', pointOptions = [], vizReadOnly = false, onNewComponent }) {
    return el(
      'div',
      { className: 'dvb-empty dvb-viz-empty' },
      el('div', { className: 'dvb-viz-empty-title' }, t('vizEmptyPoint') || '还没有可视化组件'),
      el(
        'div',
        { className: 'dvb-hint' },
        pointOptions.length ? '从已监视点位创建曲线、柱状图、数值或开关组件' : '请先在上位机点位表开启「监视」',
      ),
      el(
        'button',
        {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd || !pointOptions.length || vizReadOnly,
          title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
          onClick() {
            onNewComponent?.()
          },
        },
        t('vizNew') || '新建组件',
      ),
    )
  }
}
