// @ts-check

/**
 * Breakpoints and Hardware Watchpoints panel.
 * Parity with Phase 7 Section 11.9.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createBreakpointPanel(React, t) {
  const el = React.createElement

  return function BreakpointPanel({
    breakpoints = [],
    watchpoints = [],
    onAddBreakpoint,
    onRemoveBreakpoint,
    onAddWatchpoint,
    onRemoveWatchpoint,
    error = null,
  }) {
    const [subTab, setSubTab] = React.useState('bp') // 'bp' | 'wp'
    const [bpInput, setBpInput] = React.useState('')
    const [bpCondition, setBpCondition] = React.useState('')
    const [wpExpr, setWpExpr] = React.useState('')
    const [wpAccess, setWpAccess] = React.useState('write')

    const bpList = Array.isArray(breakpoints) ? breakpoints : []
    const wpList = Array.isArray(watchpoints) ? watchpoints : []

    const handleAddBp = (e) => {
      e?.preventDefault()
      const raw = bpInput.trim()
      if (!raw) return
      let file = ''
      let line = 0
      let fn = ''
      if (raw.includes(':')) {
        const parts = raw.split(':')
        file = parts[0].trim()
        line = parseInt(parts[1], 10) || 0
      } else if (/^\d+$/.test(raw)) {
        line = parseInt(raw, 10) || 0
      } else {
        fn = raw
      }

      if (onAddBreakpoint) {
        onAddBreakpoint({
          file: file || undefined,
          line: line || undefined,
          function: fn || undefined,
          condition: bpCondition.trim() || undefined,
        })
        setBpInput('')
        setBpCondition('')
      }
    }

    const handleAddWp = (e) => {
      e?.preventDefault()
      const expr = wpExpr.trim()
      if (!expr) return
      if (onAddWatchpoint) {
        onAddWatchpoint({
          expression: expr,
          access: wpAccess,
        })
        setWpExpr('')
      }
    }

    // Friendly error display for watchpoint exhaustion
    const isWpExhausted = error && String(error).includes('DEBUG_WATCHPOINT_RESOURCE_EXHAUSTED')

    return el(
      'div',
      { className: 'dvb-debug-panel' },
      el(
        'div',
        { className: 'dvb-debug-panel-head' },
        el(
          'div',
          { className: 'dvb-debug-tabs', style: { border: 'none', margin: 0, padding: 0 } },
          el(
            'button',
            {
              type: 'button',
              className: `dvb-debug-subtab ${subTab === 'bp' ? 'is-active' : ''}`,
              onClick: () => setSubTab('bp'),
            },
            `断点 (${bpList.length})`,
          ),
          el(
            'button',
            {
              type: 'button',
              className: `dvb-debug-subtab ${subTab === 'wp' ? 'is-active' : ''}`,
              onClick: () => setSubTab('wp'),
            },
            `硬件观察点 (${wpList.length})`,
          ),
        ),
      ),
      el(
        'div',
        { className: 'dvb-debug-panel-body' },
        isWpExhausted
          ? el(
              'div',
              {
                className: 'dvb-callout',
                style: {
                  borderColor: 'var(--dsw-alias-label-danger, #c62828)',
                  color: 'var(--dsw-alias-label-danger, #c62828)',
                  fontSize: '11px',
                },
              },
              '⚠️ 硬件观察点资源耗尽：Cortex-M 硬件 DWT 比较器资源已满，请先删除多余的观察点。',
            )
          : null,
        subTab === 'bp' &&
          el(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            el(
              'form',
              { className: 'dvb-debug-form', onSubmit: handleAddBp },
              el('input', {
                type: 'text',
                placeholder: '文件名:行号 或 函数名 (如 main.c:45 或 SysTick_Handler)',
                value: bpInput,
                onChange: (e) => setBpInput(e.target.value),
              }),
              el('input', {
                type: 'text',
                placeholder: '条件 (可选, 如 count > 10)',
                style: { maxWidth: '140px' },
                value: bpCondition,
                onChange: (e) => setBpCondition(e.target.value),
              }),
              el(
                'button',
                {
                  type: 'submit',
                  className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                  disabled: !bpInput.trim(),
                },
                '+ 添加',
              ),
            ),
            bpList.length === 0
              ? el(
                  'div',
                  { className: 'dvb-hint', style: { padding: '8px', textAlign: 'center' } },
                  '暂无断点，在上方输入 文件:行号 添加',
                )
              : bpList.map((bp) => {
                  const id = bp.id || ''
                  const label = bp.file ? `${bp.file.split(/[\\/]/).pop()}:${bp.line}` : bp.function || bp.address || id
                  const cond = bp.condition ? ` [${bp.condition}]` : ''

                  return el(
                    'div',
                    { key: id, className: 'dvb-debug-item' },
                    el(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                      el('span', { style: { color: 'var(--dsw-alias-label-danger, #c62828)' } }, '●'),
                      el('span', { style: { fontFamily: 'ui-monospace, monospace' } }, `${label}${cond}`),
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        style: { padding: '0 4px', fontSize: '10px', opacity: 0.6 },
                        title: '删除断点',
                        onClick: () => onRemoveBreakpoint && onRemoveBreakpoint(id),
                      },
                      '×',
                    ),
                  )
                }),
          ),
        subTab === 'wp' &&
          el(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            el(
              'form',
              { className: 'dvb-debug-form', onSubmit: handleAddWp },
              el('input', {
                type: 'text',
                placeholder: '变量或内存地址 (如 g_system_state 或 *(uint32_t*)0x20000000)',
                value: wpExpr,
                onChange: (e) => setWpExpr(e.target.value),
              }),
              el(
                'select',
                {
                  value: wpAccess,
                  onChange: (e) => setWpAccess(e.target.value),
                  style: { fontSize: '11px', padding: '2px 4px', borderRadius: '4px' },
                },
                el('option', { value: 'write' }, '写监视 (write)'),
                el('option', { value: 'read' }, '读监视 (read)'),
                el('option', { value: 'access' }, '读写监视 (access)'),
              ),
              el(
                'button',
                {
                  type: 'submit',
                  className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                  disabled: !wpExpr.trim(),
                },
                '+ 添加',
              ),
            ),
            wpList.length === 0
              ? el(
                  'div',
                  { className: 'dvb-hint', style: { padding: '8px', textAlign: 'center' } },
                  '暂无硬件观察点（支持写/读/读写监视）',
                )
              : wpList.map((wp) => {
                  const id = wp.id || ''
                  const expr = wp.expression || wp.expr || id
                  const access = wp.access || 'write'

                  return el(
                    'div',
                    { key: id, className: 'dvb-debug-item' },
                    el(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                      el('span', { style: { color: 'var(--dsw-alias-label-warning, #f59e0b)' } }, '◆'),
                      el('span', { style: { fontFamily: 'ui-monospace, monospace' } }, `${expr} (${access})`),
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        style: { padding: '0 4px', fontSize: '10px', opacity: 0.6 },
                        title: '删除观察点',
                        onClick: () => onRemoveWatchpoint && onRemoveWatchpoint(id),
                      },
                      '×',
                    ),
                  )
                }),
          ),
      ),
    )
  }
}
