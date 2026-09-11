// TaskP2/0.20.0: 单个可视化卡片组件 VizCard
// 负责卡片容器渲染、标题、拖动抓手、Agent 引用复制、两阶段删除确认、降级提示与 4 类渲染器分发。

import { componentLatestValues } from '../../../../../bench-trend.mjs'
import { visualizationComponentStatus } from '../../../../../bench-visualization-model.mjs'
import { getEcharts } from '../../../vendor/echarts-runtime.mjs'
import { renderBarRenderer } from '../renderers/bar-renderer.mjs'
import { renderLineRenderer } from '../renderers/line-renderer.mjs'
import { renderSwitchRenderer } from '../renderers/switch-renderer.mjs'
import { renderValueRenderer } from '../renderers/value-renderer.mjs'
import { vizTypeLabel } from '../viz-helpers.mjs'

export function createVizCard(React, t) {
  const el = React.createElement

  return function VizCard({
    comp,
    points = [],
    values = [],
    chartErrors = {},
    deleteId = '',
    focusVizId = '',
    vizReadOnly = false,
    hasInputHarness = false,
    switchDraft = null,
    cwd = '',
    onCopyRef,
    onOpenEditor,
    onRequestDelete,
    onConfirmDelete,
    onCancelDelete,
    onToggleSwitch,
    ensureChart,
    ensureBarChart,
    destroyChart,
    seriesOfComponent,
    setChartErrors,
    setTick,
  }) {
    const status = visualizationComponentStatus(comp, points)
    const byId = new Map(points.map((p) => [p.id, p]))
    const latest = componentLatestValues(values, points, comp.pointIds)
    const degraded = status !== 'ok'

    function renderCardBody() {
      if (degraded) {
        if (comp.type === 'line' && typeof destroyChart === 'function') {
          destroyChart(comp.id)
        }
        return el(
          'div',
          { className: 'dvb-viz-body' },
          el(
            'div',
            { className: 'dvb-hint dvb-need' },
            '点位已关闭监视或被删除；请编辑组件恢复。',
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              disabled: vizReadOnly,
              title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
              onClick() {
                onOpenEditor?.(comp)
              },
            },
            '修复',
          ),
        )
      }

      if (comp.type === 'line') {
        return renderLineRenderer(el, {
          comp,
          payload: seriesOfComponent?.(comp),
          chartErr: chartErrors[comp.id],
          ensureChart,
          openEditor: onOpenEditor,
          setChartErrors,
          setTick,
          t,
          readOnly: vizReadOnly,
        })
      }

      if (comp.type === 'bar') {
        return renderBarRenderer(el, {
          latest,
          comp,
          ensureChart: getEcharts() ? ensureBarChart : undefined,
        })
      }

      if (comp.type === 'value') {
        return renderValueRenderer(el, { latest, settings: comp.settings, name: comp.name })
      }

      if (comp.type === 'switch') {
        const item = latest[0] || {}
        const pt = byId.get(comp.pointIds[0]) || {}
        const pending = switchDraft?.current
        const busy = !!(pending?.busy && pending.componentId === comp.id)
        const confirmHint =
          pending && pending.componentId === comp.id && !pending.busy && pending.expiresAt > Date.now()
            ? `确认写入「${pending.desiredValue ? '开' : '关'}」…`
            : ''
        return renderSwitchRenderer(el, {
          item,
          pt,
          settings: comp.settings,
          name: comp.name,
          on: item.value === 1 || item.value === true,
          busy,
          confirmHint,
          cwd,
          readOnly: vizReadOnly,
          readOnlyTitle: vizReadOnly ? t('vizReadOnlyAction') : undefined,
          onToggle(wantOn) {
            onToggleSwitch?.(
              comp,
              { connectionId: pt.connectionId, deviceId: pt.deviceId, pointId: pt.id, address: pt.address },
              wantOn,
            )
          },
        })
      }

      return null
    }

    return el(
      'div',
      {
        className: `dvb-panel dvb-viz-card${degraded ? ' dvb-viz-degraded' : ''}${deleteId === comp.id ? ' dvb-viz-confirm' : ''}${focusVizId === comp.id ? ' dvb-viz-focused' : ''}`,
      },
      el(
        'div',
        { className: 'dvb-viz-head' },
        el(
          'div',
          { className: 'dvb-viz-head-main' },
          el(
            'div',
            { className: 'dvb-viz-title-row' },
            el('span', { className: 'dvb-viz-drag', title: '拖动排列' }, '⋮⋮'),
            el('span', { className: 'dvb-viz-title' }, comp.name),
            el('span', { className: 'dvb-viz-type' }, vizTypeLabel(comp.type)),
          ),
          el(
            'div',
            { className: 'dvb-viz-meta' },
            el('span', null, `${comp.pointIds.length} 个点位`),
            degraded ? el('span', { className: 'dvb-badge', 'data-kind': 'warn' }, '数据源不可用') : null,
          ),
        ),
        el(
          'div',
          { className: 'dvb-viz-head-actions' },
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              title: hasInputHarness ? '让 Agent 分析' : '复制引用',
              'aria-label': `让 Agent 分析组件 ${comp.name || comp.id}`,
              onClick() {
                onCopyRef?.(comp)
              },
            },
            hasInputHarness ? '让 Agent 分析' : '复制引用',
          ),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm',
              disabled: vizReadOnly,
              title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
              onClick() {
                onOpenEditor?.(comp)
              },
            },
            '编辑',
          ),
          deleteId === comp.id
            ? el(
                'span',
                { className: 'dvb-actions' },
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
                    disabled: vizReadOnly,
                    title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                    onClick() {
                      onConfirmDelete?.(comp.id)
                    },
                  },
                  '确认删除',
                ),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm',
                    onClick() {
                      onCancelDelete?.()
                    },
                  },
                  t('csvCancel') || '取消',
                ),
              )
            : el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-sm dvb-btn-danger',
                  disabled: vizReadOnly,
                  title: vizReadOnly ? t('vizReadOnlyAction') : undefined,
                  onClick() {
                    onRequestDelete?.(comp.id)
                  },
                },
                '删除',
              ),
        ),
      ),
      el('div', { className: 'dvb-viz-body-wrap' }, renderCardBody()),
    )
  }
}
