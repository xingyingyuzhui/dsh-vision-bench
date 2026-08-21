const MAX_LOG = 8
const SUMMARY_CAP = 180
const ACTIONS = new Set(['select-project', 'build', 'read'])

export const emptyLog = () => []

export const normalizeEvent = (input) => {
  const action = input && ACTIONS.has(input.action) ? input.action : 'build'
  const summary = String((input && input.summary) || '').replace(/\s+/g, ' ').trim().slice(0, SUMMARY_CAP)
  const at = Number(input && input.at)
  return {
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    action,
    ok: !!(input && input.ok),
    summary,
  }
}

export const mergeLog = (prev, event) => {
  const next = [normalizeEvent(event)]
  const old = Array.isArray(prev) ? prev : []
  for (const item of old) {
    if (next.length >= MAX_LOG) break
    next.push(normalizeEvent(item))
  }
  return next
}

const clock = (at) => {
  try {
    return new Date(at).toLocaleString('zh-CN', { hour12: false })
  } catch {
    return String(at)
  }
}

const line = (label, value) => {
  const text = String(value || '').trim()
  return text ? '- ' + label + ': ' + text : ''
}

export const renderBenchPrompt = (workspace, cwd) => {
  if (!workspace) return ''
  const keil = workspace.keil || {}
  const modbus = workspace.modbus || {}
  const log = Array.isArray(workspace.log) ? workspace.log : []
  const hasKeil = !!(keil.project || keil.target || keil.download)
  const hasLog = log.length > 0
  if (!hasKeil && !hasLog) return ''

  const lines = [
    '# Vision 台架（当前会话）',
    '',
    '这是用户在「调试 / 上位机」页留下的现场状态，不是猜测。涉及该工程、编译产物或 Modbus 时以这里为准。',
    cwd ? line('工作区', cwd) : '',
    '',
    '## 调试',
    line('Keil 工程', keil.project) || '- Keil 工程: （未选择）',
    line('Target', keil.target) || '- Target: （未选择）',
    line('下载包格式', keil.artifact || 'hex'),
    line('最近下载包', keil.download) || '- 最近下载包: （尚未编译或未生成所选格式）',
    '',
    '## 上位机',
    '- 连接: ' + (modbus.mode === 'tcp'
      ? ('TCP ' + (modbus.host || '（无主机）') + ':' + String(modbus.tcpPort || 502))
      : ('RTU ' + (modbus.port || '（无串口）'))),
    line('从站', String(modbus.slave || 1)),
  ]

  if (hasLog) {
    lines.push('', '## 最近操作')
    for (const item of log) {
      const mark = item.ok ? '成功' : '失败'
      lines.push('- ' + clock(item.at) + ' [' + mark + '] ' + (item.summary || item.action))
    }
  }

  return lines.filter((row, index, all) => {
    if (row !== '') return true
    return index > 0 && all[index - 1] !== ''
  }).join('\n').trim()
}
