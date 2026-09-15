// Form field helpers for the visualization editor drawer.

export function createVizEditorFields(el, CustomSelect, s, setS) {
  const pill = (on, fn, txt, k = txt) =>
    el('button', { key: k, type: 'button', className: `dvb-viz-filter-pill${on ? ' is-active' : ''}`, onClick: fn }, txt)

  const sec = (lbl) => el('div', { key: lbl, className: 'dvb-viz-group-title dvb-viz-span-4' }, lbl)

  const grp = (k, lbl, child, col = 2) =>
    el('div', { key: k, className: `dvb-viz-form-group dvb-viz-span-${col}` }, el('label', { className: 'dvb-viz-sublabel' }, lbl), child)

  const inp = (k, ph = '', type = 'text') =>
    el('input', { className: 'dvb-input', type, placeholder: ph, value: s[k] ?? '', onChange: (e) => setS(k, e.target.value) })

  const rowInp = (lbl, k, ph, type, col = 2) => grp(k, lbl, inp(k, ph, type), col)
  const rowNum = (lbl, k, ph) => rowInp(lbl, k, ph, 'number')

  const rowSel = (lbl, k, opts, col = 2) =>
    grp(
      k,
      lbl,
      el(CustomSelect, {
        value: String(s[k] ?? opts[0][0]),
        onChange: (val) => setS(k, val),
        options: opts.map(([v, n]) => ({ value: String(v), label: n })),
      }),
      col,
    )

  const rowPills = (lbl, k, opts, def, col = 4) =>
    grp(k, lbl, el('div', { className: 'dvb-viz-filter-pills' }, opts.map(([v, n]) => pill((s[k] ?? def) === v, () => setS(k, v), n, String(v)))), col)

  const rowColor = (lbl, k, def = '#94A3B8') => {
    const v = s[k] || def
    return grp(
      k,
      lbl,
      el(
        'div',
        { className: 'dvb-viz-color-row' },
        el('input', {
          type: 'color',
          className: 'dvb-viz-color-swatch',
          value: v[0] === '#' && v.length === 7 ? v : def,
          onChange: (e) => setS(k, e.target.value),
        }),
        inp(k, def),
      ),
    )
  }

  const rowSwitch = (k, lbl, def = true, col = 2) => {
    const on = def ? s[k] !== false : !!s[k]
    return el(
      'div',
      { key: k, className: `dvb-viz-switch-row dvb-viz-span-${col}` },
      el(
        'button',
        { type: 'button', role: 'switch', 'aria-checked': on, className: 'dvb-viz-opt-btn', onClick: () => setS(k, !on) },
        el('span', { className: `dvb-switch${on ? ' is-on' : ''}` }, el('span', { className: 'dvb-switch-track' })),
        lbl,
      ),
    )
  }

  return { pill, sec, grp, inp, rowInp, rowNum, rowSel, rowPills, rowColor, rowSwitch }
}
