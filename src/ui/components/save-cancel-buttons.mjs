export function renderCancelButton(el, t, props = {}) {
  const { onClick, disabled, text, className, size, style, title, ariaLabel } = props
  const label = text || (typeof t === 'function' ? t('cancel') : null) || '取消'
  return el('button', {
    type: 'button',
    className: `dvb-btn-pill${size === 'sm' ? ' dvb-btn-sm' : ''}${className ? ` ${className}` : ''}`,
    disabled: !!disabled,
    onClick,
    style,
    title,
    'aria-label': ariaLabel || label,
  }, label)
}

export function renderSaveButton(el, t, props = {}) {
  const { onClick, disabled, saving, text, savingText, className, size, style, title, ariaLabel } = props
  const tSave = typeof t === 'function' ? t('save') : null
  const label = saving ? (savingText || (typeof t === 'function' ? t('saving') : null) || '保存中…') : (text || (!tSave || tSave === 'save' ? '保存' : tSave))
  return el('button', {
    type: 'button',
    className: `dvb-btn-pill dvb-btn-pill-primary${size === 'sm' ? ' dvb-btn-sm' : ''}${className ? ` ${className}` : ''}`,
    disabled: !!disabled || !!saving,
    onClick,
    style,
    title,
    'aria-label': ariaLabel || (saving ? '保存中' : '保存'),
  }, label)
}

export function renderSaveCancelGroup(el, t, options = {}) {
  const { onCancel, onSave, cancelText, saveText, saving, disabled, saveDisabled, cancelDisabled, size = 'normal', reverseDomOrder, className, style, gap = 10, justifyContent = 'flex-end' } = options
  const cBtn = renderCancelButton(el, t, { onClick: onCancel, disabled: disabled || cancelDisabled, text: cancelText, size })
  const sBtn = renderSaveButton(el, t, { onClick: onSave, disabled: disabled || saveDisabled, saving, text: saveText, savingText: options.savingText, size })
  const s = reverseDomOrder
    ? { display: 'flex', flexDirection: 'row-reverse', justifyContent: 'flex-start', gap: `${gap}px`, ...style }
    : { display: 'flex', alignItems: 'center', justifyContent, gap: `${gap}px`, ...style }
  return el('div', { className: `dvb-actions${className ? ` ${className}` : ''}`, style: s }, reverseDomOrder ? sBtn : cBtn, reverseDomOrder ? cBtn : sBtn)
}

export function createSaveCancelGroup(React, t) {
  return (props) => renderSaveCancelGroup(React.createElement, t, props)
}
