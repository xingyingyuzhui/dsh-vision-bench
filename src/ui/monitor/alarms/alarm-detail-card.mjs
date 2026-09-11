import { COMM, COND_ACTIVE } from '../../../../bench-alarm.mjs'
import {
  buildAlarmTimelineNodes,
  formatAlarmAck,
  formatAlarmCondition,
  formatAlarmCurrentValue,
  formatAlarmSeverity,
  formatAlarmSubtitle,
  formatAlarmTitle,
  formatAlarmTriggerCondition,
  formatFullDateTime,
} from './alarm-format.mjs'

export function createAlarmDetailCard(React, t) {
  const el = React.createElement

  return function AlarmDetailCard(props) {
    const { row, onAck, onJumpPoint, onSendToAgent } = props
    const [copied, setCopied] = React.useState(false)

    if (!row || !row.a) {
      return el(
        'div',
        { className: 'dvb-detail-card dvb-alarm-detail is-empty' },
        el('div', { className: 'dvb-detail-head' }, el('span', { className: 'dvb-detail-title' }, '告警详情')),
        el('div', { className: 'dvb-detail-empty-hint' }, '请从左侧列表选择一条告警查看详情'),
      )
    }

    const { a: alarm, pt, conn, dev } = row
    const title = formatAlarmTitle(alarm, pt, conn, dev)
    const sev = formatAlarmSeverity(alarm.severity)
    const cond = formatAlarmCondition(alarm)
    const ack = formatAlarmAck(alarm)
    const timelineNodes = buildAlarmTimelineNodes(alarm)

    const typeLabel = alarm.group === COMM || String(alarm.id).startsWith('comm:') ? '通信告警' : '过程告警'
    const pointLabel = pt
      ? `${dev ? dev.name + ' / ' : ''}${alarm.pointId}${pt.name ? ` (${pt.name})` : ''}`
      : conn
        ? `${conn.name || conn.id} (${conn.conn?.port || 'COM'})`
        : alarm.label || alarm.id

    const currentValueStr = formatAlarmCurrentValue(alarm, pt)
    const triggerConditionStr = formatAlarmTriggerCondition(alarm, pt)
    const firstTimeStr = formatFullDateTime(alarm.firstAt || alarm.lastAt)

    const handleCopy = () => {
      if (typeof onSendToAgent === 'function') {
        onSendToAgent(row)
        setCopied(true)
        setTimeout(() => setCopied(false), 2000)
        return
      }
      const summaryText = `[${typeLabel}] ${title} (${sev.label})
状态: ${cond.label} · ${ack.label}
关联: ${pointLabel}
当前值: ${currentValueStr}
触发条件: ${triggerConditionStr}
发生时间: ${firstTimeStr}`
      try {
        if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
          navigator.clipboard.writeText(summaryText).then(() => {
            setCopied(true)
            setTimeout(() => setCopied(false), 2000)
          })
        }
      } catch {}
    }

    const isAcked = !!alarm.acknowledged

    return el(
      'div',
      { className: 'dvb-detail-card dvb-alarm-detail' },
      el(
        'div',
        { className: 'dvb-detail-head' },
        el('span', { className: 'dvb-detail-title' }, '告警详情'),
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
        el(
          'div',
          { className: 'dvb-detail-title-row' },
          el('span', { className: 'dvb-detail-title-lg' }, title),
          el('span', { className: `dvb-pill ${sev.className}` }, `${sev.icon} ${sev.label}`),
        ),
        el(
          'div',
          { className: `dvb-alarm-status-line ${cond.active ? 'is-active' : 'is-recovered'}` },
          `▶ ${cond.label} · ${ack.label}`,
        ),
      ),
      el(
        'div',
        { className: 'dvb-detail-kv-list' },
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '告警类型'),
          el('span', { className: 'dvb-detail-v' }, typeLabel),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '关联点位'),
          el('span', { className: 'dvb-detail-v' }, pointLabel),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '当前值'),
          el('span', { className: 'dvb-detail-v dvb-detail-v-danger' }, currentValueStr),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '触发条件'),
          el('span', { className: 'dvb-detail-v' }, triggerConditionStr),
        ),
        el(
          'div',
          { className: 'dvb-detail-kv' },
          el('span', { className: 'dvb-detail-k' }, '发生时间'),
          el('span', { className: 'dvb-detail-v' }, firstTimeStr),
        ),
      ),
      el(
        'div',
        { className: 'dvb-detail-timeline-section' },
        el('div', { className: 'dvb-detail-section-title' }, '处理记录'),
        el(
          'div',
          { className: 'dvb-timeline' },
          timelineNodes.map((node, idx) =>
            el(
              'div',
              { key: idx, className: `dvb-timeline-item dot-${node.dotType}` },
              el('div', { className: 'dvb-timeline-dot' }),
              idx < timelineNodes.length - 1 ? el('div', { className: 'dvb-timeline-line' }) : null,
              el(
                'div',
                { className: 'dvb-timeline-content' },
                node.time ? el('div', { className: 'dvb-timeline-time' }, node.time) : null,
                el(
                  'div',
                  { className: 'dvb-timeline-desc' },
                  el('span', { className: 'dvb-timeline-title' }, node.title),
                  node.tag ? el('span', { className: 'dvb-timeline-tag' }, node.tag) : null,
                ),
              ),
            ),
          ),
        ),
      ),
      el(
        'div',
        { className: 'dvb-detail-actions' },
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn dvb-btn-primary dvb-btn-ack${isAcked ? ' is-disabled' : ''}`,
            disabled: isAcked,
            onClick() {
              if (!isAcked && typeof onAck === 'function') onAck(alarm.id)
            },
          },
          isAcked ? '已确认告警' : '确认告警',
        ),
        el('div', { className: 'dvb-detail-action-subtext' }, '确认表示已知悉，不代表故障恢复。'),
        pt
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-link-btn dvb-jump-point-link',
                onClick() {
                  if (typeof onJumpPoint === 'function') onJumpPoint(row)
                },
              },
              '查看关联点位 >',
            )
          : null,
      ),
    )
  }
}
