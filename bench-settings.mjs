import { NS } from './bench-i18n.mjs'
import { renderToggleSwitch } from './src/ui/components/toggle-switch.mjs'
import { renderSaveButton } from './src/ui/components/save-cancel-buttons.mjs'

const FIELDS = [
  { key: 'uv4', label: 'uv4', ph: 'uv4Ph' },
  { key: 'openocd', label: 'openocd', ph: 'openocdPh' },
]

const SHARE_BOXES = [
  { key: 'connections', label: 'shareConnections' },
  { key: 'points', label: 'sharePoints' },
  { key: 'visualization', label: 'shareVisualization' },
]

const EMPTY_SHARE = { enabled: false, connections: false, points: false, visualization: false }

export const PRESERVE_NAV_STORAGE_KEY = 'dsh-vision-bench:preserve-nav:enabled'

export function getPreserveNavPreference() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    return window.localStorage.getItem(PRESERVE_NAV_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setPreserveNavPreference(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(PRESERVE_NAV_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {}
}

export function statusKind(health) {
  if (!health || !health.bound) return 'unbound'
  return health.exists ? 'ready' : 'missing'
}

export function pluginVersionLabel() {
  // Build injects `v${package.json.version}`; unbundled source falls back to vdev.
  const injected =
    typeof globalThis !== 'undefined' && typeof globalThis.__DVB_BUILD_VERSION__ === 'string'
      ? globalThis.__DVB_BUILD_VERSION__
      : ''
  return injected || 'vdev'
}

function ioStatusInfo(ioRuntime, t) {
  const state = ioRuntime && ioRuntime.state
  const isUnavailable = state === 'unavailable' || state === 'unhealthy' || state === 'stopped'
  const kind = isUnavailable ? 'missing' : 'ready'
  let label = t('ioReady')
  if (state === 'starting') label = t('ioPending')
  else if (isUnavailable) label = t('ioUnavailable')
  return { kind, label }
}

function normalizeShareState(flags) {
  const src = flags && typeof flags === 'object' ? flags : {}
  return {
    enabled: src.enabled === true,
    connections: src.connections === true,
    points: src.points === true,
    visualization: src.visualization === true,
  }
}

function shareEffective(flags, key) {
  return flags.enabled === true && flags[key] === true
}

function willRevoke(prev, next) {
  return SHARE_BOXES.some((box) => shareEffective(prev, box.key) && !shareEffective(next, box.key))
}

function confirmRevoke(t) {
  if (typeof window === 'undefined' || typeof window.confirm !== 'function') return false
  return window.confirm(t('shareRevokeConfirm')) === true
}

export function createSettingsPage(React, t, post, options = {}) {
  const getScope = typeof options.getScope === 'function' ? options.getScope : () => ({ cwd: '', sessionId: '' })
  return function SettingsPage() {
    const el = React.createElement
    const [bindings, setBindings] = React.useState({ python: '', uv4: '', openocd: '' })
    const [health, setHealth] = React.useState({})
    const [busy, setBusy] = React.useState(false)
    const [checking, setChecking] = React.useState(false)
    const [checks, setChecks] = React.useState(null)
    const [message, setMessage] = React.useState(null)
    const [ioRuntime, setIoRuntime] = React.useState(null)
    const [share, setShare] = React.useState(EMPTY_SHARE)
    const [configVersion, setConfigVersion] = React.useState(1)
    const [shareBusy, setShareBusy] = React.useState(false)
    const [preserveNav, setPreserveNav] = React.useState(() => getPreserveNavPreference())

    const scope = getScope() || {}
    const cwd = String(scope.cwd || '')
    const sessionId = String(scope.sessionId || '')
    const applySnap = (data) => {
      if (data && data.bindings) setBindings(data.bindings)
      if (data && data.health) setHealth(data.health)
      if (data && data.ioRuntime) setIoRuntime(data.ioRuntime)
      if (data && data.globalShare) {
        setShare(normalizeShareState(data.globalShare))
      } else {
        const modbus = data && data.workspace && data.workspace.modbus
        if (modbus && modbus.share) setShare(normalizeShareState(modbus.share))
      }
      const modbus = data && data.workspace && data.workspace.modbus
      if (modbus && modbus.configVersion) setConfigVersion(Number(modbus.configVersion) || 1)
    }

    React.useEffect(() => {
      post('/dsh-vision-bench/state', cwd ? { cwd, sessionId } : {})
        .then(applySnap)
        .catch((err) => {
          setMessage({ kind: 'err', text: String((err && err.message) || t('loadFail')) })
        })
    }, [cwd, sessionId])

    function setField(key, value) {
      setBindings((prev) => Object.assign({}, prev, { [key]: value }))
    }

    function save() {
      setBusy(true)
      setMessage(null)
      post('/dsh-vision-bench/bindings', { bindings, share })
        .then((data) => {
          applySnap(data)
          setMessage({ kind: data.ok ? 'ok' : 'err', text: data.ok ? t('saved') : data.error || t('fail') })
        })
        .catch((err) => {
          setMessage({ kind: 'err', text: String((err && err.message) || t('fail')) })
        })
        .finally(() => setBusy(false))
    }

    function runCheck() {
      setChecking(true)
      setChecks(null)
      post('/dsh-vision-bench/selfcheck', {}, 60000)
        .then((data) => {
          if (data && Array.isArray(data.checks)) setChecks(data)
          else setMessage({ kind: 'err', text: (data && data.error) || t('fail') })
        })
        .catch((err) => {
          setMessage({ kind: 'err', text: String((err && err.message) || t('fail')) })
        })
        .finally(() => setChecking(false))
    }

    function applyShare(nextShare, confirmed) {
      const next = normalizeShareState(nextShare)
      let confirmedFlag = confirmed === true
      if (!confirmedFlag && willRevoke(share, next)) {
        if (!confirmRevoke(t)) return
        confirmedFlag = true
      }
      setShareBusy(true)
      setMessage(null)
      post('/dsh-vision-bench/bindings', {
        bindings,
        share: next,
        cwd: cwd || undefined,
        sessionId: sessionId || undefined,
      })
        .then((data) => {
          if (data && data.ok) {
            if (data.globalShare) setShare(normalizeShareState(data.globalShare))
            else setShare(next)
            setMessage({ kind: 'ok', text: t('shareSaved') })
            return post('/dsh-vision-bench/state', cwd ? { cwd, sessionId } : {}).then(applySnap)
          }
          setMessage({ kind: 'err', text: (data && data.error) || t('fail') })
        })
        .catch((err) => {
          setMessage({ kind: 'err', text: String((err && err.message) || t('fail')) })
        })
        .finally(() => setShareBusy(false))
    }

    function renderSwitch(checked, disabled, onChange, id) {
      return renderToggleSwitch(el, { checked, disabled, onChange, id })
    }

    function settingRow(labelNode, controlNode, isSub = false) {
      return el(
        'div',
        { className: isSub ? 'dvb-setting-row dvb-setting-subrow' : 'dvb-setting-row' },
        el('div', { className: 'dvb-setting-label' }, labelNode),
        el('div', { className: 'dvb-setting-control' }, controlNode),
      )
    }

    return el(
      'div',
      { className: 'dvb-page' },
      settingRow(
        el(
          React.Fragment,
          null,
          el('span', { className: 'dvb-setting-name' }, t('pluginVersion')),
          el('span', { className: 'dvb-tag', title: '插件版本' }, pluginVersionLabel()),
        ),
        null,
      ),
      (() => {
        const ioInfo = ioStatusInfo(ioRuntime, t)
        return settingRow(
          el(
            React.Fragment,
            null,
            el('span', { className: 'dvb-setting-name' }, t('ioRuntime')),
            el(
              'span',
              {
                className: 'dvb-status-pill',
                'data-kind': ioInfo.kind,
              },
              el('span', {
                className: 'dvb-dot',
                'data-kind': ioInfo.kind,
              }),
              el('span', null, ioInfo.label),
            ),
          ),
          null,
        )
      })(),
      FIELDS.map((field) => {
        const kind = statusKind(health[field.key])
        return el(
          'div',
          { key: field.key, className: 'dvb-setting-row' },
          el(
            'div',
            { className: 'dvb-setting-label' },
            el('span', { className: 'dvb-setting-name' }, t(field.label)),
            el('span', { className: 'dvb-status-pill', 'data-kind': kind }, t(kind)),
          ),
          el(
            'div',
            { className: 'dvb-setting-control' },
            el('input', {
              className: 'dvb-input-pill',
              value: bindings[field.key] || '',
              placeholder: t(field.ph),
              spellCheck: false,
              onChange(event) {
                setField(field.key, event.target.value)
              },
            }),
          ),
        )
      }),
      el(
        'div',
        {
          className: 'dvb-actions',
          style: { justifyContent: 'flex-end', gap: '10px', marginTop: '6px' },
        },
        el(
          'button',
          { type: 'button', className: 'dvb-btn-pill', disabled: checking, onClick: runCheck },
          checking ? t('selfchecking') : t('selfcheck'),
        ),
        renderSaveButton(el, t, {
          saving: busy,
          onClick: save,
        }),
      ),
      el('div', { className: 'dvb-title', style: { marginTop: '16px' } }, t('shareTitle')),
      el('div', { className: 'dvb-hint', style: { marginBottom: '6px' } }, t('shareHint')),
      settingRow(
        el('span', { style: { fontWeight: 500 } }, t('shareMaster')),
        renderSwitch(share.enabled === true, shareBusy, (enabled) => applyShare({ ...share, enabled }), 'share-master'),
      ),
      el(
        'div',
        {
          className: 'dvb-share-subgroup',
          style: {
            pointerEvents: share.enabled ? 'auto' : 'none',
          },
        },
        SHARE_BOXES.map((box) =>
          settingRow(
            el(
              'span',
              {
                style: {
                  color: share.enabled
                    ? 'var(--dsw-alias-label-primary, inherit)'
                    : 'var(--dsw-alias-label-tertiary, #8b93a0)',
                },
              },
              t(box.label),
            ),
            renderSwitch(
              share[box.key] === true,
              shareBusy || share.enabled !== true,
              (on) => applyShare({ ...share, [box.key]: on }),
              'share-' + box.key,
            ),
            true,
          ),
        ),
      ),
      el('div', { className: 'dvb-title', style: { marginTop: '16px' } }, t('navBehaviorTitle')),
      el('div', { className: 'dvb-hint', style: { marginBottom: '6px' } }, t('preserveLastViewHint')),
      settingRow(
        el('span', { style: { fontWeight: 500 } }, t('preserveLastView')),
        renderSwitch(
          preserveNav,
          false,
          (on) => {
            setPreserveNav(on)
            setPreserveNavPreference(on)
          },
          'preserve-last-view',
        ),
      ),
      message ? el('div', { className: 'dvb-msg', 'data-kind': message.kind }, message.text) : null,
      checks
        ? el(
            'div',
            { className: 'dvb-journal' },
            el(
              'div',
              { className: 'dvb-journal-title' },
              t('selfcheckTitle') + ' · ' + (checks.ok ? t('selfcheckPass') : t('selfcheckFail')),
            ),
            checks.checks.map((item) =>
              el(
                'div',
                {
                  key: item.name,
                  className: 'dvb-task',
                  'data-ok': item.ok ? 'true' : 'false',
                },
                el('span', { className: 'dvb-badge' }, item.ok ? '✓' : '✗'),
                el('span', null, item.name),
                el('span', { className: 'dvb-hint' }, item.detail),
              ),
            ),
            checks.capabilities
              ? Object.entries(checks.capabilities).map(([key, cap]) =>
                  el(
                    'div',
                    {
                      key: 'cap-' + key,
                      className: 'dvb-task',
                      'data-ok': cap && cap.ready ? 'true' : 'false',
                    },
                    el('span', { className: 'dvb-badge' }, cap && cap.ready ? '✓' : '✗'),
                    el('span', null, key),
                    el('span', { className: 'dvb-hint' }, (cap && cap.reason) || ''),
                  ),
                )
              : null,
          )
        : null,
    )
  }
}

export function registerSettings(ctx, React, t, Page) {
  const slots = ctx.slots
  if (slots == null || React == null) return function () {}
  return slots.inject('settings.section', function () {
    return slots.register(
      {
        name: 'settings.section',
        id: 'dsh-vision-bench',
        order: 46,
        locale: NS,
        label() {
          return t('nav')
        },
      },
      Page,
    )
  })
}
