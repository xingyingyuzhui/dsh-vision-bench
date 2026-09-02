import { languageForPath } from './project-tree-model.mjs'
import { createProjectConfigPanel } from './project-config-panel.mjs'

export function createProjectPreviewPanel(React, t, SourceEditor) {
  const ConfigPanel = createProjectConfigPanel(React, t)
  return function ProjectPreviewPanel({
    preview,
    jumpLine,
    onClose,
    mapped,
    counts,
    cfgOpen,
    onToggleCfg,
  }) {
    const el = React.createElement
    return el(
      'div',
      { className: 'dvb-project-preview' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el(
          'span',
          { className: 'dvb-panel-title' },
          preview?.rel ? `源码 · ${preview.rel}` : '源码预览',
        ),
        preview?.truncated ? el('span', { className: 'dvb-hint dvb-need' }, '超过 256KB，已截断') : null,
        preview?.rel
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
        !preview?.rel
          ? el(
              'div',
              { className: 'dvb-project-preview-empty' },
              el('div', { className: 'dvb-hint' }, '在左侧选择文件以预览源码，或从编译错误定位跳转。'),
            )
          : preview.loading
            ? el('div', { className: 'dvb-hint', style: { padding: '12px' } }, t('opening'))
            : preview.error
              ? el('div', { className: 'dvb-msg', 'data-kind': 'err', style: { margin: '8px' } }, preview.error)
              : el(SourceEditor, {
                  text: preview.text || '',
                  rel: preview.rel || '',
                  jumpLine,
                  language: languageForPath(preview.rel),
                }),
      ),
      mapped
        ? el(ConfigPanel, {
            mapped,
            counts: counts || {},
            cfgOpen,
            onToggle: onToggleCfg,
          })
        : null,
    )
  }
}
