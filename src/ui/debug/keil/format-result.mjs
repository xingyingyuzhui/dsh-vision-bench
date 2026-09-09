// TaskP2: Keil 编译/后处理结果与日志信息格式化

export function formatResult(result) {
  if (!result) return ''
  const details = result.details || {}
  const metrics = result.metrics || {}
  const lines = []
  if (result.summary) lines.push(result.summary)
  if (metrics.compile_errors != null || metrics.after_build_errors != null) {
    lines.push(
      `编译/链接 ${String(metrics.compile_errors || 0)} · 后处理 ${String(metrics.after_build_errors || 0)} · 警告 ${String(metrics.warnings || 0)}`,
    )
  } else if (metrics.errors != null) {
    lines.push(`errors=${metrics.errors} warnings=${metrics.warnings}`)
  }
  if (details.phase && details.phase !== 'ok') {
    lines.push(details.phase === 'after_build' ? '阶段: 后处理' : '阶段: 编译/链接')
  }
  const errs = Array.isArray(details.errors) ? details.errors : []
  if (errs.length) {
    lines.push('错误:')
    for (const item of errs.slice(0, 8)) lines.push(`  ${item}`)
  }
  if (details.log_file) lines.push(`日志: ${details.log_file}`)
  if (result.download?.path) {
    lines.push(`${result.download.wanted}: ${result.download.path}`)
  } else if (result.download?.wanted) {
    lines.push(
      `未生成 ${result.download.wanted}${
        result.download.available?.length ? `（已有 ${result.download.available.join(', ')}）` : ''
      }`,
    )
  } else if (details.flash_file) {
    lines.push(details.flash_file)
  }
  if (details.value !== undefined) lines.push(`value=${JSON.stringify(details.value)}`)
  return lines.filter(Boolean).join('\n') || JSON.stringify(result, null, 2)
}

export function agentNote(cwd, workspace, result) {
  const keil = workspace?.keil ? workspace.keil : {}
  const download = result?.download ? result.download : {}
  const metrics = result?.metrics ? result.metrics : {}
  return [
    '[Vision]',
    `工作区: ${cwd || ''}`,
    `工程: ${keil.project || ''}`,
    `Target: ${keil.target || ''}`,
    `输出格式: ${keil.artifact || 'hex'}`,
    download.path ? `输出: ${download.path}` : result ? '输出: 未生成所选格式' : '',
    result?.summary ? `结果: ${result.summary}` : '',
    metrics.compile_errors != null
      ? `编译/链接=${metrics.compile_errors} 后处理=${metrics.after_build_errors} warnings=${metrics.warnings}`
      : metrics.errors != null
        ? `errors=${metrics.errors} warnings=${metrics.warnings}`
        : '',
    result?.details?.log_file ? `日志: ${result.details.log_file}` : '',
    result?.details && Array.isArray(result.details.errors) && result.details.errors.length
      ? `错误: ${result.details.errors.slice(0, 4).join(' | ')}`
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}
