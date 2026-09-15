/**
 * Top tools row: protocol/raw mode, HEX/Text encoding, auto-scroll pause,
 * clear view, and export menu. Filter row lives in frames-filter-toolbar.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 */
export function createFramesToolsToolbar(React, t) {
  const el = React.createElement

  return function FramesToolsToolbar(props) {
    const {
      mode,
      switchMode,
      encoding,
      setEncoding,
      paused,
      togglePause,
      clearView,
      filteredLength,
      exportOpen,
      setExportOpen,
      downloadFrames,
      copyFrames,
      exportFrames,
    } = props

    return el(
      'div',
      { className: 'dvb-frames-tools' },
      el(
        'div',
        { className: 'dvb-frames-seg' },
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${mode === 'proto' ? ' is-on' : ''}`,
            onClick() {
              switchMode('proto')
            },
          },
          t('framesProto') || '协议报文',
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${mode === 'raw' ? ' is-on' : ''}`,
            onClick() {
              switchMode('raw')
            },
          },
          t('framesRaw') || '原始数据',
        ),
      ),
      el(
        'div',
        { className: 'dvb-frames-seg' },
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${encoding === 'hex' ? ' is-on' : ''}`,
            onClick() {
              setEncoding('hex')
            },
          },
          'HEX',
        ),
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${encoding === 'text' ? ' is-on' : ''}`,
            onClick() {
              setEncoding('text')
            },
          },
          'Text',
        ),
      ),
      el(
        'label',
        { className: 'dvb-frames-follow' },
        el(
          'button',
          {
            type: 'button',
            role: 'switch',
            'data-action': 'pause',
            className: `dvb-switch${!paused ? ' is-on' : ''}`,
            'aria-checked': paused ? 'false' : 'true',
            title: paused ? t('serialResume') || '恢复' : t('serialPause') || '暂停',
            onClick: togglePause,
          },
          el('span', { className: 'dvb-switch-track' }),
        ),
        el('span', null, '自动滚动'),
      ),
      el('button', { type: 'button', className: 'dvb-btn', onClick: clearView }, t('framesClearView') || '清空显示'),
      el(
        'div',
        { className: 'dvb-frames-export' },
        el(
          'button',
          {
            type: 'button',
            className: `dvb-btn${exportOpen ? ' is-on' : ''}`,
            disabled: !filteredLength,
            onClick: () => setExportOpen((v) => !v),
          },
          t('framesExport') || '导出',
        ),
        exportOpen
          ? el(
              'div',
              { className: 'dvb-frames-export-menu' },
              el(
                'button',
                { type: 'button', className: 'dvb-btn', onClick: () => downloadFrames('txt') },
                '下载 TXT',
              ),
              el(
                'button',
                { type: 'button', className: 'dvb-btn', onClick: () => downloadFrames('json') },
                '下载 JSON',
              ),
              el('button', { type: 'button', className: 'dvb-btn', onClick: copyFrames }, '复制文本'),
              el('button', { type: 'button', className: 'dvb-btn', onClick: exportFrames }, '复制 JSON'),
            )
          : null,
      ),
    )
  }
}
