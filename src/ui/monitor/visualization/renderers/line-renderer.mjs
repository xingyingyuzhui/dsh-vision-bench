import { hasTrendSamples } from '../viz-helpers.mjs'

export function renderLineRenderer(el, spec) {
  const comp = spec.comp
  const payload = spec.payload
  const chartErr = spec.chartErr
  const ensureChart = spec.ensureChart || spec.ensureUplot
  const openEditor = spec.openEditor
  const setChartErrors = spec.setChartErrors
  const setTick = spec.setTick
  const t = spec.t
  return el(
    'div',
    { className: 'dvb-viz-body' },
    chartErr
      ? el(
          'div',
          { className: 'dvb-msg dvb-viz-chart-error', 'data-kind': 'err' },
          el('span', null, chartErr),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              title: '重试渲染该曲线',
              onClick() {
                setChartErrors((prev) => {
                  const next = { ...prev }
                  delete next[comp.id]
                  return next
                })
                setTick((n) => n + 1)
              },
            },
            '重试',
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              disabled: spec.readOnly,
              title: spec.readOnly ? spec.t('vizReadOnlyAction') : undefined,
              onClick() {
                openEditor(comp)
              },
            },
            '编辑',
          ),
        )
      : hasTrendSamples(payload)
        ? el('div', {
            ref: (node) => {
              if (node && ensureChart) ensureChart(node, comp)
            },
            className: 'dvb-viz-uplot dvb-viz-chart',
            style: { width: '100%', height: '100%', minHeight: '150px' },
          })
        : el('div', { className: 'dvb-hint' }, t('vizWaitingSamples') || '暂无历史样本，等待采集…'),
  )
}
