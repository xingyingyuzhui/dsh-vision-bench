import { NS } from './bench-i18n.mjs'

const FIELDS = [
  { key: 'python', label: 'python', ph: 'pythonPh' },
  { key: 'uv4', label: 'uv4', ph: 'uv4Ph' },
  { key: 'openocd', label: 'openocd', ph: 'openocdPh' },
]

export function statusKind(health) {
  if (!health || !health.bound) return 'unbound'
  return health.exists ? 'ready' : 'missing'
}

export function createSettingsPage(React, t, post) {
  return function SettingsPage() {
    const el = React.createElement
    const [bindings, setBindings] = React.useState({ python: '', uv4: '', openocd: '' })
    const [health, setHealth] = React.useState({})
    const [busy, setBusy] = React.useState(false)
    const [message, setMessage] = React.useState(null)

    const applySnap = (data) => {
      if (data && data.bindings) setBindings(data.bindings)
      if (data && data.health) setHealth(data.health)
    }

    React.useEffect(() => {
      post('/dsh-vision-bench/state').then(applySnap).catch((err) => {
        setMessage({ kind: 'err', text: String((err && err.message) || t('loadFail')) })
      })
    }, [])

    function setField(key, value) {
      setBindings((prev) => Object.assign({}, prev, { [key]: value }))
    }

    function save() {
      setBusy(true)
      setMessage(null)
      post('/dsh-vision-bench/bindings', { bindings }).then((data) => {
        applySnap(data)
        setMessage({ kind: data.ok ? 'ok' : 'err', text: data.ok ? t('saved') : (data.error || t('fail')) })
      }).catch((err) => {
        setMessage({ kind: 'err', text: String((err && err.message) || t('fail')) })
      }).finally(() => setBusy(false))
    }

    return el('div', { className: 'dvb-page' },
      el('div', { className: 'dvb-title' }, t('settingsTitle')),
      el('div', { className: 'dvb-hint' }, t('settingsHint')),
      FIELDS.map((field) => {
        const kind = statusKind(health[field.key])
        return el('div', { key: field.key, className: 'dvb-row' },
          el('div', { className: 'dvb-label' },
            el('span', null, t(field.label)),
            el('span', { className: 'dvb-status', 'data-kind': kind }, t(kind))),
          el('input', {
            className: 'dvb-input',
            value: bindings[field.key] || '',
            placeholder: t(field.ph),
            spellCheck: false,
            onChange(event) { setField(field.key, event.target.value) },
          }))
      }),
      el('div', { className: 'dvb-actions' },
        el('button', { type: 'button', className: 'dvb-btn', disabled: busy, onClick: save },
          busy ? t('saving') : t('save'))),
      message ? el('div', { className: 'dvb-msg', 'data-kind': message.kind }, message.text) : null)
  }
}

export function registerSettings(ctx, React, t, Page) {
  const slots = ctx.get ? ctx.get('slots') : ctx.slots
  if (slots == null || React == null) return function () {}
  return slots.inject('settings.section', function () {
    return slots.register({
      name: 'settings.section',
      id: 'dsh-vision-bench',
      order: 46,
      locale: NS,
      label() { return t('nav') },
    }, Page)
  })
}
