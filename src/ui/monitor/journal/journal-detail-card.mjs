import {
  formatFullDateTime,
  formatJournalAction,
  formatJournalResult,
  formatJournalResultDetail,
  formatJournalSource,
  formatJournalTarget,
  serializeJournalItem,
} from './journal-format.mjs'
import { renderEmptyState } from '../../components/empty-state.mjs'

export function createJournalDetailCard(React, t) {
  const el = React.createElement

  return function JournalDetailCard(props) {
    const { item, onAddToAgent, onJumpTask } = props


    if (!item) {
      return el(
        'div',
        { className: 'dvb-detail-card dvb-journal-detail is-empty' },
        el('div', { className: 'dvb-detail-head' }, el('span', { className: 'dvb-detail-title' }, '操作详情')),
        renderEmptyState(el, {
          kind: 'empty',
          detail: '请从左侧列表选择一条操作记录查看详情',
          className: 'dvb-detail-empty-hint',
        }),
      )
    }

    const res = formatJournalResult(item)
    const src = formatJournalSource(item.source)
    const actionName = formatJournalAction(item)
    const targetName = formatJournalTarget(item)
    const resultDetail = formatJournalResultDetail(item)
    const timeStr = formatFullDateTime(item.at || item.startedAt)
    const jsonStr = serializeJournalItem(item)

    const taskLabel = item.taskSummary || item.taskId || (item.kind && item.kind.includes('仿真') ? item.kind : '仿真数据读取')

    return el(
      'div',
      { className: 'dvb-detail-card dvb-journal-detail' },
      el(
        'div',
        { className: 'dvb-detail-head' },
        el('span', { className: 'dvb-detail-title' }, '操作详情'),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm dvb-ai-btn',
            title: '让 Agent 分析此操作',
            'aria-label': '让 Agent 分析操作',
            onClick() {
              if (typeof onAddToAgent === 'function') onAddToAgent(item)
            },
          },
          'AI',
        ),
      ),
      el(
        'div',
        { className: 'dvb-detail-summary-block' },
        el('span', { className: `dvb-pill ${res.className}` }, `${res.icon} ${res.label}`),
        el('div', { className: 'dvb-detail-title-lg' }, item.summary || `${actionName} ${targetName}`),
      ),
      el(
        'div',
        { className: 'dvb-detail-kv-list' },
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '操作'),
          el('span', { className: 'dvb-detail-v' }, actionName),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '来源'),
          el('span', { className: `dvb-pill ${src.className}` }, `${src.icon} ${src.label}`),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '时间'),
          el('span', { className: 'dvb-detail-v' }, timeStr),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '对象'),
          el('span', { className: 'dvb-detail-v' }, targetName),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '执行结果'),
          el('span', { className: 'dvb-detail-v' }, resultDetail),
        ),
      ),
      el(
        'div',
        { className: 'dvb-detail-task-section' },
        el('span', { className: 'dvb-detail-task-label' }, '关联任务'),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-detail-task-link',
            onClick() {
              if (typeof onJumpTask === 'function') onJumpTask(item)
            },
          },
          `🔗 ${taskLabel} >`,
        ),
      ),
      el(
        'div',
        { className: 'dvb-detail-raw-section' },
        el('div', { className: 'dvb-raw-label' }, '原始记录'),
        el('div', { className: 'dvb-raw-box' }, el('pre', { className: 'dvb-raw-pre' }, jsonStr)),
      ),
    )
  }
}
