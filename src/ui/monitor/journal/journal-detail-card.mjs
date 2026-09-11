import {
  formatFullDateTime,
  formatJournalAction,
  formatJournalResult,
  formatJournalResultDetail,
  formatJournalSource,
  formatJournalTarget,
  serializeJournalItem,
} from './journal-format.mjs'

export function createJournalDetailCard(React, t) {
  const el = React.createElement

  return function JournalDetailCard(props) {
    const { item, onAddToAgent, onJumpTask } = props
    const [rawExpanded, setRawExpanded] = React.useState(true)
    const [copied, setCopied] = React.useState(false)

    if (!item) {
      return el(
        'div',
        { className: 'dvb-detail-card dvb-journal-detail is-empty' },
        el('div', { className: 'dvb-detail-head' }, el('span', { className: 'dvb-detail-title' }, '操作详情')),
        el('div', { className: 'dvb-detail-empty-hint' }, '请从左侧列表选择一条操作记录查看详情'),
      )
    }

    const res = formatJournalResult(item)
    const src = formatJournalSource(item.source)
    const actionName = formatJournalAction(item)
    const targetName = formatJournalTarget(item)
    const resultDetail = formatJournalResultDetail(item)
    const timeStr = formatFullDateTime(item.at || item.startedAt)
    const jsonStr = serializeJournalItem(item)

    const handleCopy = () => {
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(jsonStr).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }
      } catch {}
    }

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
            className: 'dvb-btn dvb-btn-sm dvb-btn-copy',
            onClick: handleCopy,
          },
          el(
            'svg',
            {
              viewBox: '0 0 24 24',
              width: 13,
              height: 13,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              style: { marginRight: 4 },
            },
            el('rect', { x: 9, y: 9, width: 13, height: 13, rx: 2, ry: 2 }),
            el('path', { d: 'M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1' }),
          ),
          copied ? '已复制' : '复制',
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
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-raw-toggle',
            onClick() {
              setRawExpanded(!rawExpanded)
            },
          },
          el('span', null, '📄 原始记录'),
          el(
            'span',
            { className: `dvb-raw-chevron${rawExpanded ? ' is-open' : ''}` },
            rawExpanded ? '⌵' : '›',
          ),
        ),
        rawExpanded
          ? el(
              'div',
              { className: 'dvb-raw-box' },
              el('pre', { className: 'dvb-raw-pre' }, jsonStr),
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-detail-actions' },
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-agent-input',
            onClick() {
              if (typeof onAddToAgent === 'function') onAddToAgent(item)
            },
          },
          el(
            'svg',
            {
              viewBox: '0 0 24 24',
              width: 14,
              height: 14,
              fill: 'none',
              stroke: 'currentColor',
              strokeWidth: 2,
              strokeLinecap: 'round',
              strokeLinejoin: 'round',
              style: { marginRight: 6 },
            },
            el('line', { x1: 12, y1: 5, x2: 12, y2: 19 }),
            el('line', { x1: 5, y1: 12, x2: 19, y2: 12 }),
          ),
          '添加到 Agent 输入',
        ),
        el('div', { className: 'dvb-detail-action-subtext' }, '仅填入输入框，不自动发送。'),
      ),
    )
  }
}
