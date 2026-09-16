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
 *
 * `renderModalDialog` stays the pure structural form (ADR-025 D2). Lifecycle
 * (Escape, initial focus, focus restore) lives in `createModalDialog`.
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
    loading = false,
    confirmLoading = false,
    titleId,
    confirmButtonRef,
    maskRef,
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
      ref: maskRef,
      role: 'dialog',
      'aria-modal': 'true',
      'aria-labelledby': titleId,
      'aria-busy': loading ? 'true' : undefined,
      onClick() {
        if (maskClosable && typeof onClose === 'function') onClose()
      },
    },
    el(
      'div',
      {
        className: `dvb-dialog${isErr ? ' is-error' : isWarn ? ' is-warn' : ''}`,
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
          el('span', { className: 'dvb-dialog-title', id: titleId }, finalTitle),
        ),
        onClose
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-dialog-close',
                disabled: loading,
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
      el('div', { className: 'dvb-dialog-body' }, content || message || children),
      el(
        'div',
        { className: 'dvb-dialog-footer' },
        showCancel
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-dialog-btn dvb-dialog-btn-cancel',
                disabled: loading,
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
            ref: confirmButtonRef,
            'aria-busy': confirmLoading ? 'true' : undefined,
            className: `dvb-btn dvb-dialog-btn ${danger ? 'dvb-dialog-btn-danger dvb-btn-danger-solid' : 'dvb-dialog-btn-primary dvb-btn-primary'}`,
            disabled: loading || confirmLoading,
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

let fallbackDialogId = 0

/**
 * Hook-bearing wrapper. Owns the dialog lifecycle the structural form cannot:
 * Escape closes (once), initial focus moves into the dialog, and focus returns
 * to the element that was focused before the dialog opened.
 *
 * @param {any} React
 * @param {(key: string) => string} [t]
 */
export function createModalDialog(React, t) {
  const el = React.createElement
  return function ModalDialog(props) {
    const open = Boolean(props && props.open)
    const maskRef = React.useRef(null)
    const confirmRef = React.useRef(null)
    const restoreRef = React.useRef(null)
    const latestRef = React.useRef(props)
    const generated = typeof React.useId === 'function' ? React.useId() : `dvb-dialog-${(fallbackDialogId += 1)}`
    const titleId = (props && props.titleId) || `${generated}-title`

    // Keep the Escape handler reading current props instead of the closure from
    // the render that opened the dialog.
    React.useEffect(() => {
      latestRef.current = props
    })

    React.useEffect(() => {
      if (!open) return undefined
      const node = maskRef.current
      const ownerDocument = (node && node.ownerDocument) || (typeof document !== 'undefined' ? document : null)
      const previous = ownerDocument && ownerDocument.activeElement
      restoreRef.current = previous && previous !== ownerDocument.body ? previous : null

      const current = latestRef.current || {}
      const initial = (current.initialFocusRef && current.initialFocusRef.current) || confirmRef.current
      if (initial && typeof initial.focus === 'function') {
        try {
          initial.focus()
        } catch {}
      }

      const onKeyDown = (event) => {
        if (event.key !== 'Escape') return
        event.preventDefault?.()
        event.stopPropagation?.()
        const host = latestRef.current || {}
        const close = host.onClose || host.onCancel || host.onConfirm
        if (typeof close === 'function') close()
      }
      ownerDocument?.addEventListener('keydown', onKeyDown)
      return () => {
        ownerDocument?.removeEventListener('keydown', onKeyDown)
        const restore = restoreRef.current
        restoreRef.current = null
        if (restore && typeof restore.focus === 'function') {
          try {
            restore.focus()
          } catch {}
        }
      }
      // props may be a fresh object every render; only `open` changes the lifecycle.
    }, [open])

    if (!props || !props.open) return null
    return renderModalDialog(el, t, { ...props, titleId, maskRef, confirmButtonRef: confirmRef })
  }
}

