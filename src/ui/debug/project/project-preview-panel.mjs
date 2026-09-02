import { languageForPath } from './project-tree-model.mjs'
import { createProjectConfigPanel } from './project-config-panel.mjs'
import { matchesIdentity } from './project-shared.mjs'

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
  }) {
    const el = React.createElement
    const activePreview = matchesIdentity(preview, identityKey) ? preview : null
    const activeMapped = matchesIdentity(mapped, identityKey) ? mapped : null
    const activeJumpLine = activePreview ? jumpLine : 0
    return el(
      'div',
      { className: 'dvb-project-preview' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el(
          'span',
          { className: 'dvb-panel-title' },
          activePreview?.rel ? `源码 · ${activePreview.rel}` : '源码预览',
        ),
        activePreview?.truncated ? el('span', { className: 'dvb-hint dvb-need' }, '超过 256KB，已截断') : null,
        activePreview?.rel
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-sm',
                onClick: onClose,
              },
              t('csvCancel'),
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-project-preview-body' },
        !activePreview?.rel
          ? el(
              'div',
              { className: 'dvb-project-preview-empty' },
              el('div', { className: 'dvb-hint' }, '在左侧选择文件以预览源码，或从编译错误定位跳转。'),
            )
          : activePreview.loading
            ? el('div', { className: 'dvb-hint', style: { padding: '12px' } }, t('opening'))
            : activePreview.error
              ? el('div', { className: 'dvb-msg', 'data-kind': 'err', style: { margin: '8px' } }, activePreview.error)
              : el(SourceEditor, {
                  text: activePreview.text || '',
                  rel: activePreview.rel || '',
                  jumpLine: activeJumpLine,
                  language: languageForPath(activePreview.rel),
                }),
      ),
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
