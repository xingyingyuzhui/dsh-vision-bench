import { getCustomSelect } from '../../components/custom-select.mjs'
import { createHint, createPanel, createTabs } from '../../components/primitives.mjs'

/**
 * Breakpoints and Hardware Watchpoints panel.
 * Parity with Phase 7 Section 11.9.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createBreakpointPanel(React, t) {
  const el = React.createElement
  const CustomSelect = getCustomSelect(React)
  const Panel = createPanel(React)
  const Tabs = createTabs(React)
  const Hint = createHint(React)

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
    const [adding, setAdding] = React.useState(false)
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
        setAdding(false)
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
      Panel,
      null,
      el(
        Panel.Head,
        null,
        el(Tabs, {
          value: subTab,
          onChange: setSubTab,
          items: [
            { key: 'bp', label: '断点', count: bpList.length },
            { key: 'wp', label: '硬件观察点', count: wpList.length },
          ],
        }),
        el(
          'button',
          {
            type: 'button',
            className: 'dvb-btn dvb-btn-sm dvb-debug-add-bp-btn',
            onClick: () => setAdding((v) => !v),
          },
          adding ? '取消' : '+ 添加断点',
        ),
      ),
      el(
        Panel.Body,
        null,
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
            adding
              ? el(
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
                )
              : null,
            bpList.length === 0
              ? el(Hint, null, '暂无断点，在上方输入 文件:行号 添加')
              : bpList.map((bp) => {
                  const id = bp.id || ''
                  const label = bp.file ? `${bp.file.split(/[\\/]/).pop()}:${bp.line}` : bp.function || bp.address || id
                  const cond = bp.condition ? ` [${bp.condition}]` : ''

                  return el(
                    'div',
                    { key: id, className: 'dvb-debug-item' },
                    el(
                      'div',
                      { className: 'dvb-debug-bp-info' },
                      el('input', {
                        type: 'checkbox',
                        checked: bp.enabled !== false,
                        readOnly: true,
                        className: 'dvb-debug-bp-check',
                        'aria-label': '启用断点',
                      }),
                      el('span', { className: 'dvb-debug-bp-dot' }, '●'),
                      el('span', { className: 'dvb-debug-bp-loc' }, `${label}${cond}`),
                    ),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm dvb-debug-item-del',
                        title: '删除断点',
                        onClick: () => onRemoveBreakpoint && onRemoveBreakpoint(id),
                      },
                      '⋮',
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
              el(CustomSelect, {
                size: 'sm',
                style: { width: '135px', flex: 'none' },
                value: wpAccess,
                options: [
                  { value: 'write', label: '写监视 (write)' },
                  { value: 'read', label: '读监视 (read)' },
                  { value: 'access', label: '读写监视 (access)' },
                ],
                onChange(val) {
                  const next = val?.target ? val.target.value : val
                  setWpAccess(next)
                },
              }),
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
              ? el(Hint, null, '暂无硬件观察点（支持写/读/读写监视）')
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
