/**
 * Formatting helpers for Journal / Operation records page.
 */

export function pad2(n) {
  return String(n).padStart(2, '0')
}

export function formatFullDateTime(ts) {
  if (!ts) return '-'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return String(ts)
  const y = d.getFullYear()
  const m = pad2(d.getMonth() + 1)
  const day = pad2(d.getDate())
  const h = pad2(d.getHours())
  const min = pad2(d.getMinutes())
  const s = pad2(d.getSeconds())
  return `${y}-${m}-${day} ${h}:${min}:${s}`
}

export function formatTimeOnly(ts) {
  if (!ts) return '--:--:--'
  const d = new Date(Number(ts))
  if (Number.isNaN(d.getTime())) return String(ts)
  return `${pad2(d.getHours())}:${pad2(d.getMinutes())}:${pad2(d.getSeconds())}`
}

export function isSameDay(ts1, ts2) {
  const d1 = new Date(Number(ts1))
  const d2 = new Date(Number(ts2))
  return (
    d1.getFullYear() === d2.getFullYear() &&
    d1.getMonth() === d2.getMonth() &&
    d1.getDate() === d2.getDate()
  )
}

export function formatJournalSource(source) {
  const s = String(source || 'system').toLowerCase()
  if (s === 'user' || s === 'manual') {
    return { key: 'user', label: '用户', icon: '👤', className: 'dvb-pill-user' }
  }
  if (s === 'agent') {
    return { key: 'agent', label: 'Agent', icon: '🤖', className: 'dvb-pill-agent' }
  }
  return { key: 'system', label: '系统', icon: '⚙️', className: 'dvb-pill-system' }
}

export function isJournalSuccess(item) {
  if (!item) return true
  if (item.ok === false) return false
  if (item.kind === 'error') return false
  const sum = String(item.summary || '')
  if (sum.includes('失败') || sum.includes('异常') || sum.includes('error')) return false
  return true
}

export function formatJournalResult(item) {
  const ok = isJournalSuccess(item)
  if (ok) {
    return { ok: true, label: '成功', icon: '✔', className: 'dvb-pill-success' }
  }
  return { ok: false, label: '失败', icon: '✖', className: 'dvb-pill-fail' }
}

export function formatJournalAction(item) {
  if (!item) return '操作'
  const kind = String(item.kind || item.type || '')
  const sum = String(item.summary || '')
  if (kind.includes('write') || sum.includes('写入')) return '写入点位'
  if (kind.includes('read') || sum.includes('读取')) return '读取点位'
  if (kind.includes('build') || sum.includes('编译')) return '固件编译'
  if (kind.includes('flash') || sum.includes('烧录')) return '固件烧录'
  if (kind.includes('alarm') || sum.includes('告警')) return '告警处理'
  if (kind.includes('task') || sum.includes('任务')) return '任务执行'
  return item.action || item.kind || '系统操作'
}

export function formatJournalTarget(item) {
  if (!item) return '-'
  if (item.pointId) {
    const devPart = item.deviceId ? `${item.deviceId}:` : ''
    const namePart = item.pointName ? ` (${item.pointName})` : ''
    return `${devPart}${item.pointId}${namePart}`
  }
  if (item.deviceId) return `设备 ${item.deviceId}`
  if (item.connectionId) return `连接 ${item.connectionId}`
  if (item.taskId) return `任务 ${item.taskId}`
  if (item.target) return String(item.target)
  return '-'
}

export function formatJournalResultDetail(item) {
  if (!item) return '-'
  if (item.error) return `执行失败: ${item.error}`
  if (item.resultDetail) return String(item.resultDetail)
  const ok = isJournalSuccess(item)
  if (ok) {
    if (formatJournalAction(item) === '写入点位') {
      return '写入成功，目标寄存器已更新'
    }
    if (formatJournalAction(item) === '读取点位') {
      return '读取成功，数据已刷新'
    }
    return item.summary || '操作执行成功'
  }
  return item.summary || '执行失败，请检查连接或参数'
}

export function serializeJournalItem(item) {
  if (!item) return '{}'
  try {
    const clean = {
      id: item.id,
      timestamp: item.at || item.startedAt || Date.now(),
      action: formatJournalAction(item),
      target: formatJournalTarget(item),
      source: item.source || 'system',
      status: isJournalSuccess(item) ? 'success' : 'failed',
      summary: item.summary || '',
      taskId: item.taskId || undefined,
      pointId: item.pointId || undefined,
      deviceId: item.deviceId || undefined,
      connectionId: item.connectionId || undefined,
    }
    return JSON.stringify(clean, null, 2)
  } catch {
    return JSON.stringify({ id: item.id || '' })
  }
}
