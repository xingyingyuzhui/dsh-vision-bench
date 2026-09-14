import { matchesIdentity } from './project-shared.mjs'
import { createProjectConfigPanel } from './project-config-panel.mjs'
import { languageForPath } from './project-tree-model.mjs'

export function createProjectPreviewPanel(React, t, SourceEditor) {
  const ConfigPanel = createProjectConfigPanel(React, t)
  return function ProjectPreviewPanel({
    preview,
    identityKey,
    jumpLine,
    onClose,
    mapped,
    counts,
    cfgOpen,
    onToggleCfg,
    onJumpLine,
    selectedFile,
    selectedGroup,
    isDemo,
  }) {
    const el = React.createElement
    const activePreview = (isDemo || preview?.isDemo) ? preview : (matchesIdentity(preview, identityKey) ? preview : null)
    const activeMapped = isDemo ? mapped : (matchesIdentity(mapped, identityKey) ? mapped : null)
    const activeJumpLine = activePreview ? jumpLine : 0
    const rel = activePreview?.rel

    const [jumpInput, setJumpInput] = React.useState('')
    const [symbolsOpen, setSymbolsOpen] = React.useState(true)

    const fns = selectedFile?.functions || []
    const fileName = rel ? rel.split(/[\\/]/).pop() || rel : ''
    const groupName = selectedGroup || 'Source Group1'

    const handleJump = () => {
      const l = parseInt(jumpInput, 10)
      if (l > 0) onJumpLine?.(l)
    }

    return el(
      'div',
      { className: 'dvb-project-preview' },
      el(
        'div',
        { className: 'dvb-preview-header' },
        el(
          'div',
          { className: 'dvb-preview-head-left' },
          rel
            ? el(
                'div',
                { className: 'dvb-preview-breadcrumb' },
                el('span', { className: 'dvb-breadcrumb-group' }, groupName),
                el('span', { className: 'dvb-breadcrumb-sep' }, ' / '),
                el('span', { className: 'dvb-breadcrumb-file' }, fileName),
              )
            : el('span', { className: 'dvb-panel-title' }, '源码预览'),
          el('span', { style: { display: 'none' } }, rel ? `源码 · ${rel}` : ''),
          rel ? el('span', { className: 'dvb-chip dvb-preview-readonly-badge' }, '只读') : null,
          activePreview?.truncated ? el('span', { className: 'dvb-hint dvb-need' }, '超过 256KB，已截断') : null,
        ),
        rel
          ? el(
              'div',
              { className: 'dvb-preview-toolbar-right' },
              el(
                'div',
                { className: 'dvb-preview-fn-select-wrap' },
                el('span', { className: 'dvb-preview-sub-label' }, '函数'),
                fns.length > 0
                  ? el(
                      'select',
                      {
                        className: 'dvb-input dvb-preview-fn-select',
                        value:
                          activeJumpLine && fns.find((f) => f.line === activeJumpLine)
                            ? String(activeJumpLine)
                            : String(fns[0].line),
                        onChange: (e) => {
                          const l = Number(e.target.value)
                          if (l > 0) onJumpLine?.(l)
                        },
                      },
                      fns.map((f) => el('option', { key: f.name, value: String(f.line) }, `${f.name}()`)),
                    )
                  : el('span', { className: 'dvb-hint' }, '无函数'),
              ),
              el(
                'div',
                { className: 'dvb-preview-jump-wrap' },
                el('span', { className: 'dvb-preview-sub-label' }, '行'),
                el('input', {
                  type: 'number',
                  className: 'dvb-input dvb-preview-jump-input',
                  placeholder: '6',
                  value: jumpInput,
                  onChange: (e) => setJumpInput(e.target.value),
                  onKeyDown: (e) => e.key === 'Enter' && handleJump(),
                }),
                el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn dvb-btn-sm dvb-btn-primary dvb-preview-jump-btn',
                    onClick: handleJump,
                  },
                  '跳转',
                ),
              ),
            )
          : null,
      ),

      // 3. Body
      el(
        'div',
        { className: 'dvb-project-preview-body' },
        !rel
          ? el(
              'div',
              { className: 'dvb-project-preview-empty' },
              el('div', { className: 'dvb-hint' }, '在左侧选择文件以预览源码，或从编译错误定位跳转。'),
            )
          : activePreview.loading
            ? el('div', { className: 'dvb-hint' }, t('opening'))
            : activePreview.error
              ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, activePreview.error)
              : el(
                  'div',
                  { className: 'dvb-preview-code-box' },
                  el(
                    'div',
                    { className: 'dvb-preview-code-head' },
                    el('span', { className: 'dvb-preview-code-title' }, '示例源码'),
                  ),
                  el(
                    'div',
                    { className: 'dvb-preview-editor-wrap' },
                    el(SourceEditor, {
                      text: activePreview.text || '',
                      rel,
                      jumpLine: activeJumpLine || 6,
                      language: languageForPath(rel),
                    }),
                  ),
                ),
      ),

      // 4. Symbols Section (文件符号)
      rel && fns.length > 0
        ? el(
            'div',
            { className: 'dvb-preview-symbols-panel' },
            el(
              'div',
              {
                className: 'dvb-preview-symbols-head',
                onClick: () => setSymbolsOpen((v) => !v),
              },
              el(
                'span',
                { className: 'dvb-preview-symbols-title' },
                '文件符号',
              ),
              el('span', { className: 'dvb-preview-symbols-count' }, `${fns.length}个函数`),
            ),
            symbolsOpen
              ? el(
                  'div',
                  { className: 'dvb-preview-symbols-list' },
                  fns.map((fn) =>
                    el(
                      'div',
                      {
                        key: `${fn.name}:${fn.line}`,
                        className: 'dvb-preview-symbol-row',
                        onClick: () => onJumpLine?.(fn.line),
                      },
                      el('span', { className: 'dvb-glyph-fn' }, '𝑓'),
                      el('span', { className: 'dvb-symbol-name' }, fn.name),
                      el('span', { className: 'dvb-symbol-params' }, '(void)'),
                    ),
                  ),
                )
              : null,
          )
        : null,

      activeMapped
        ? el(ConfigPanel, {
            mapped: activeMapped,
            counts: counts || {},
            cfgOpen,
            onToggle: onToggleCfg,
          })
        : null,
    )
  }
}
