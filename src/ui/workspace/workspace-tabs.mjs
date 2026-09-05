export function renderWorkspaceTabs(el, spec) {
  const sections = spec && Array.isArray(spec.sections) ? spec.sections : []
  const active = spec?.active
  const labels = spec?.labels || {}
  const onSelect = spec?.onSelect
  function handleTabKeyDown(e) {
    if (e.key === 'ArrowRight' || e.key === 'ArrowLeft') {
      e.preventDefault()
      const idx = sections.indexOf(active)
      let nextIdx = idx
      if (e.key === 'ArrowRight') nextIdx = (idx + 1) % sections.length
      if (e.key === 'ArrowLeft') nextIdx = (idx - 1 + sections.length) % sections.length
      const nid = sections[nextIdx]
      if (nid && typeof onSelect === 'function') onSelect(nid)
    } else if (e.key === 'Home') {
      e.preventDefault()
      if (sections[0] && typeof onSelect === 'function') onSelect(sections[0])
    } else if (e.key === 'End') {
      e.preventDefault()
      const last = sections[sections.length - 1]
      if (last && typeof onSelect === 'function') onSelect(last)
    }
  }
  return el(
    'div',
    { className: 'dvb-ws-tabs', role: 'tablist', onKeyDown: handleTabKeyDown },
    ...sections.map((id) =>
      el(
        'button',
        {
          key: id,
          type: 'button',
          role: 'tab',
          className: `dvb-tab${active === id ? ' is-on' : ''}`,
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
