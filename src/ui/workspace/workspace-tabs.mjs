export function renderWorkspaceTabs(el, spec) {
  const sections = spec && Array.isArray(spec.sections) ? spec.sections : []
  const active = spec?.active
  const labels = spec?.labels || {}
  const onSelect = spec?.onSelect
  return el(
    'div',
    { className: 'dvb-ws-tabs', role: 'tablist' },
    ...sections.map((id) =>
      el(
        'button',
        {
          key: id,
          type: 'button',
          role: 'tab',
          className: `dvb-btn${active === id ? ' is-on' : ''}`,
          'data-section': id,
          'aria-selected': active === id ? 'true' : 'false',
          onClick() {
            if (typeof onSelect === 'function') onSelect(id)
          },
        },
        labels[id] || id,
      ),
    ),
  )
}
