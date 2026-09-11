import { COMM, COND_ACTIVE, PROCESS } from '../../../../bench-alarm.mjs'
import { formatFullDateTime, formatTimeOnly, pad2 } from '../journal/journal-format.mjs'

export { formatFullDateTime, formatTimeOnly, pad2 }

export function formatAlarmTitle(alarm, pt, conn, dev) {
  if (!alarm) return '未知告警'
  if (alarm.group === COMM || String(alarm.id).startsWith('comm:')) {
    const portOrName = conn ? (conn.name || conn.conn?.port || conn.id) : alarm.label || '串口'
    return `${portOrName}通讯中断`
  }
  const devName = dev ? dev.name : ''
  const ptName = pt ? (pt.name || pt.id) : (alarm.label || alarm.pointId || '点位')
  const conditionStr = alarm.kind === 'max' ? '过高' : alarm.kind === 'min' ? '过低' : '超限'
  if (devName && !ptName.includes(devName)) {
    return `${devName}${ptName}${conditionStr}`
  }
  return `${ptName}${conditionStr}`
}

export function formatAlarmSubtitle(alarm, pt, conn, dev) {
  if (!alarm) return '-'
  if (alarm.group === COMM || String(alarm.id).startsWith('comm:')) {
    const portOrName = conn ? (conn.name || conn.conn?.port || 'COM') : 'COM'
    return `通信 · ${portOrName}`
  }
  const devName = dev ? dev.name : (alarm.deviceId || '设备')
  return `过程 · ${devName}`
}

export function formatAlarmSeverity(severity) {
  const s = String(severity || '').toLowerCase()
  if (s === 'high' || s === 'critical' || s === '严重') {
    return { key: 'critical', label: '严重', icon: '!', className: 'dvb-pill-severe' }
  }
  return { key: 'warn', label: '警告', icon: '⚠', className: 'dvb-pill-warn' }
}

export function formatAlarmCondition(alarm) {
  const isActive = !alarm || alarm.condition === COND_ACTIVE
  if (isActive) {
    return { active: true, label: '激活', className: 'dvb-pill-active' }
  }
  return { active: false, label: '已恢复', className: 'dvb-pill-recovered' }
}

export function formatAlarmAck(alarm) {
  const isAcked = !!(alarm && alarm.acknowledged)
  if (isAcked) {
    return { acked: true, label: '已确认', className: 'dvb-pill-acked' }
  }
  return { acked: false, label: '未确认', className: 'dvb-pill-unacked' }
}

export function formatAlarmCurrentValue(alarm, pt) {
  if (!alarm || alarm.value == null) return '-'
  const unit = (pt && pt.unit) || ''
  return `${alarm.value}${unit ? ` ${unit}` : ''}`
}

export function formatAlarmTriggerCondition(alarm, pt) {
  if (!alarm) return '-'
  if (alarm.group === COMM || String(alarm.id).startsWith('comm:')) {
    return '连续 3 次轮询无应答或 CRC 校验错误'
  }
  const unit = (pt && pt.unit) || ''
  const op = alarm.kind === 'min' ? '<' : '>'
  const th = alarm.threshold != null ? alarm.threshold : pt ? (alarm.kind === 'min' ? pt.alarmMin : pt.alarmMax) : null
  if (th != null) {
    return `${op} ${th}${unit ? ` ${unit}` : ''} (持续超过 3s)`
  }
  return '越限触发'
}

export function buildAlarmTimelineNodes(alarm) {
  if (!alarm) return []
  const nodes = []

  // Node 1: Trigger
  const triggerTime = formatFullDateTime(alarm.firstAt || alarm.lastAt)
  nodes.push({
    time: triggerTime,
    title: '告警触发',
    tag: alarm.acknowledged ? '已确认' : '待确认',
    dotType: 'danger',
  })

  // Node 2: Acknowledged (if present)
  if (alarm.acknowledged && alarm.ackedAt) {
    nodes.push({
      time: formatFullDateTime(alarm.ackedAt),
      title: `用户确认 (${alarm.ackedBy || 'user'})`,
      tag: '已确认',
      dotType: 'primary',
    })
  }

  // Node 3: Recovered (if present)
  if (alarm.condition !== COND_ACTIVE && alarm.recoveredAt) {
    nodes.push({
      time: formatFullDateTime(alarm.recoveredAt),
      title: '告警恢复',
      tag: '已恢复',
      dotType: 'success',
    })
  } else if (!alarm.acknowledged) {
    // Show placeholder for subsequent events
    nodes.push({
      time: '',
      title: '暂无更多记录',
      tag: '',
      dotType: 'empty',
    })
  }

  return nodes
}
