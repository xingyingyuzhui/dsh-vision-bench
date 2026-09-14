// @ts-check

import { createHint, createPanel, createTabs } from '../../components/primitives.mjs'

/**
 * Variables, Watches, and Registers panel.
 * Parity with Phase 7 Section 11.8.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createVariablesPanel(React, t) {
  const el = React.createElement
  const Panel = createPanel(React)
  const Tabs = createTabs(React)
  const Hint = createHint(React)

  return function VariablesPanel({
    locals = [],
    watches = [],
    watchValues = [],
    registers = [],
    onAddWatch,
    onRemoveWatch,
    onRefresh,
  }) {
    const [subTab, setSubTab] = React.useState('locals') // 'locals' | 'watches' | 'registers'
    const [watchInput, setWatchInput] = React.useState('')

    const handleAddWatch = (e) => {
      e?.preventDefault()
      const trimmed = watchInput.trim()
      if (trimmed && onAddWatch) {
        onAddWatch(trimmed)
        setWatchInput('')
      }
    }

    return el(
      Panel,
      null,
      el(
        Panel.Head,
        { className: 'dvb-debug-vars-head' },
        el(
          'div',
          { className: 'dvb-debug-vars-tabs-row' },
          el(Tabs, {
            value: subTab,
            onChange: setSubTab,
            items: [
              { key: 'locals', label: '局部变量', count: locals.length },
              { key: 'watches', label: '监视', count: watches.length },
              { key: 'registers', label: '寄存器', count: registers.length },
            ],
          }),
          el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-sm dvb-debug-vars-refresh-btn',
              title: '手动刷新变量',
              onClick: () => onRefresh && onRefresh(),
            },
            '↻ 刷新',
          ),
        ),
        subTab === 'locals'
          ? el(
              'div',
              { className: 'dvb-debug-var-table-header' },
              el('span', { className: 'dvb-var-col dvb-col-name' }, '名称'),
              el('span', { className: 'dvb-var-col dvb-col-type' }, '类型'),
              el('span', { className: 'dvb-var-col dvb-col-val' }, '值'),
            )
          : null,
      ),
      el(
        Panel.Body,
        null,
        subTab === 'locals' &&
          (locals.length === 0
            ? el(Hint, null, '暂无局部变量（可在暂停时查看当前栈帧局部变量）')
            : locals.map((item, idx) => {
                const name = item.name || `var_${idx}`
                const val = item.value != null ? String(item.value) : 'undefined'
                const type = item.type || '-'

                return el(
                  'div',
                  { key: name, className: 'dvb-debug-var-row' },
                  el('span', { className: 'dvb-debug-var-name dvb-var-col dvb-col-name' }, name),
                  el('span', { className: 'dvb-debug-var-type dvb-var-col dvb-col-type' }, type),
                  el('span', { className: 'dvb-debug-var-val dvb-var-col dvb-col-val' }, val),
                )
              })),
        subTab === 'watches' &&
          el(
            'div',
            { style: { display: 'flex', flexDirection: 'column', gap: '4px' } },
            el(
              'form',
              { className: 'dvb-debug-form', onSubmit: handleAddWatch },
              el('input', {
                type: 'text',
                placeholder: '输入表达式 (如 g_system_state, &buffer[0])',
                value: watchInput,
                onChange: (e) => setWatchInput(e.target.value),
              }),
              el(
                'button',
                {
                  type: 'submit',
                  className: 'dvb-btn dvb-btn-sm dvb-btn-primary',
                  disabled: !watchInput.trim(),
                },
                '+ 添加',
              ),
            ),
            watches.length === 0
              ? el(Hint, null, '暂无监视表达式，在上方输入表达式即可添加')
              : watches.map((expr) => {
                  const valItem = watchValues.find((v) => v.expression === expr)
                  const hasErr = Boolean(valItem?.error)
                  const displayVal = hasErr ? valItem.error : valItem?.value != null ? String(valItem.value) : '...'

                  return el(
                    'div',
                    { key: expr, className: 'dvb-debug-var-row' },
                    el('span', { className: 'dvb-debug-var-name' }, expr),
                    el(
                      'div',
                      { style: { display: 'flex', alignItems: 'center', gap: '6px' } },
                      el(
                        'span',
                        {
                          className: 'dvb-debug-var-val',
                          style: hasErr ? { color: 'var(--dsw-alias-label-danger, #c62828)' } : undefined,
                        },
                        displayVal,
                      ),
                      el(
                        'button',
                        {
                          type: 'button',
                          className: 'dvb-btn dvb-btn-sm',
                          style: { padding: '0 4px', fontSize: '10px', opacity: 0.6 },
                          title: '删除监视',
                          onClick: () => onRemoveWatch && onRemoveWatch(expr),
                        },
                        '×',
                      ),
                    ),
                  )
                }),
          ),
        subTab === 'registers' &&
          (registers.length === 0
            ? el(Hint, null, '暂无寄存器信息（暂停时自动获取 CPU 寄存器）')
            : registers.map((reg) => {
                const name = reg.name || 'reg'
                const val = reg.value != null ? String(reg.value) : ''

                return el(
                  'div',
                  { key: name, className: 'dvb-debug-var-row' },
                  el('span', { className: 'dvb-debug-var-name' }, name.toUpperCase()),
                  el('span', { className: 'dvb-debug-var-val' }, val),
                )
              })),
      ),
    )
  }
}
