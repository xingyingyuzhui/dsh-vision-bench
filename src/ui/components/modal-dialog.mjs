function resolveI18n(t, key, fallback) {
  if (typeof t !== 'function') return fallback
  const val = t(key)
  if (!val || val === key) return fallback
  return val
}

function renderDialogIcon(el, kind) {
  if (kind === 'err' || kind === 'error') {
    return el(
      'div',
      { className: 'dvb-dialog-icon is-error' },
      el(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        el('circle', { cx: 12, cy: 12, r: 10 }),
        el('line', { x1: 12, y1: 8, x2: 12, y2: 12 }),
        el('line', { x1: 12, y1: 16, x2: 12.01, y2: 16 }),
      ),
    )
  }
  if (kind === 'warn' || kind === 'warning') {
    return el(
      'div',
      { className: 'dvb-dialog-icon is-warn' },
      el(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        el('path', {
          d: 'M10.29 3.86L1.82 18a2 2 0 0 0 1.71 3h16.94a2 2 0 0 0 1.71-3L13.71 3.86a2 2 0 0 0-3.42 0z',
        }),
        el('line', { x1: 12, y1: 9, x2: 12, y2: 13 }),
        el('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ),
    )
  }
  if (kind === 'confirm') {
    return el(
      'div',
      { className: 'dvb-dialog-icon is-confirm' },
      el(
        'svg',
        {
          width: 18,
          height: 18,
          viewBox: '0 0 24 24',
          fill: 'none',
          stroke: 'currentColor',
          strokeWidth: 2,
          strokeLinecap: 'round',
          strokeLinejoin: 'round',
        },
        el('circle', { cx: 12, cy: 12, r: 10 }),
        el('path', { d: 'M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3' }),
        el('line', { x1: 12, y1: 17, x2: 12.01, y2: 17 }),
      ),
    )
  }
  return el(
    'div',
    { className: 'dvb-dialog-icon is-info' },
    el(
      'svg',
      {
        width: 18,
        height: 18,
        viewBox: '0 0 24 24',
        fill: 'none',
        stroke: 'currentColor',
        strokeWidth: 2,
        strokeLinecap: 'round',
        strokeLinejoin: 'round',
      },
      el('circle', { cx: 12, cy: 12, r: 10 }),
      el('line', { x1: 12, y1: 16, x2: 12, y2: 12 }),
      el('line', { x1: 12, y1: 8, x2: 12.01, y2: 8 }),
    ),
  )
}

/**
 * Reusable modal dialog component formatted to match DSH design system.
 * Supports Alert, Confirm, and Custom content dialogs.
 */
export function renderModalDialog(el, t, props) {
  if (!props || !props.open) return null
  const {
    title,
    message,
    content,
    kind = 'info', // 'info' | 'warn' | 'err' | 'confirm'
    confirmText,
    cancelText,
    showCancel = kind === 'confirm' || !!props.onCancel,
    danger = false,
    onConfirm,
    onCancel,
    onClose = onCancel || onConfirm,
    maskClosable = true,
    width,
    children,
  } = props

  const isErr = kind === 'err' || kind === 'error'
  const isWarn = kind === 'warn' || kind === 'warning'
  const defaultTitle = isErr
    ? resolveI18n(t, 'dialogTitleError', '操作提示')
    : isWarn
      ? resolveI18n(t, 'dialogTitleWarn', '警告')
      : kind === 'confirm'
        ? resolveI18n(t, 'dialogTitleConfirm', '确认')
        : resolveI18n(t, 'dialogTitleNotice', '提示')
  const finalTitle = title || defaultTitle

  const finalConfirmText =
    confirmText || (danger ? resolveI18n(t, 'confirm', '确认') : resolveI18n(t, 'dialogOk', '确定'))
  const finalCancelText = cancelText || resolveI18n(t, 'cancel', '取消')

  return el(
    'div',
    {
      className: 'dvb-mask',
      role: 'dialog',
      'aria-modal': 'true',
      onClick() {
        if (maskClosable && typeof onClose === 'function') onClose()
      },
    },
    el(
      'div',
      {
        className: 'dvb-dialog' + (isErr ? ' is-error' : isWarn ? ' is-warn' : ''),
        style: width ? { width } : null,
        onClick(e) {
          e.stopPropagation()
        },
      },
      el(
        'div',
        { className: 'dvb-dialog-header' },
        el(
          'div',
          { className: 'dvb-dialog-title-wrap' },
          renderDialogIcon(el, kind),
          el('span', { className: 'dvb-dialog-title' }, finalTitle),
        ),
        onClose
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-dialog-close',
                'aria-label': resolveI18n(t, 'pickerClose', '关闭'),
                onClick() {
                  onClose()
                },
              },
              el(
                'svg',
                {
                  width: 14,
                  height: 14,
                  viewBox: '0 0 24 24',
                  fill: 'none',
                  stroke: 'currentColor',
                  strokeWidth: 2.2,
                  strokeLinecap: 'round',
                  strokeLinejoin: 'round',
                },
                el('line', { x1: 18, y1: 6, x2: 6, y2: 18 }),
                el('line', { x1: 6, y1: 6, x2: 18, y2: 18 }),
              ),
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-dialog-body' },
        content || message || children,
      ),
      el(
        'div',
        { className: 'dvb-dialog-footer' },
        showCancel
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-dialog-btn dvb-dialog-btn-cancel',
                onClick() {
                  if (typeof onCancel === 'function') onCancel()
                  else if (typeof onClose === 'function') onClose()
                },
              },
              finalCancelText,
            )
          : null,
        el(
          'button',
          {
            type: 'button',
            className:
              'dvb-btn dvb-dialog-btn ' +
              (danger
                ? 'dvb-dialog-btn-danger dvb-btn-danger-solid'
                : 'dvb-dialog-btn-primary dvb-btn-primary'),
            onClick() {
              if (typeof onConfirm === 'function') onConfirm()
              else if (typeof onClose === 'function') onClose()
            },
          },
          finalConfirmText,
        ),
      ),
    ),
  )
}

export function createModalDialog(React, t) {
  const el = React.createElement
  return function ModalDialog(props) {
    return renderModalDialog(el, t, props)
  }
}
