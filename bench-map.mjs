import { getBetterSidebar, sessionCwd } from './bench-live.mjs'

const TAB_MAP = 'dsh-vision-bench:project'

function fileMark(t, file) {
  if (!file.inside) return t('mapOutside')
  if (!file.exists) return t('mapMissing')
  if (!file.readable) return t('mapUnreadable')
  return ''
}

function truncated(mapped) {
  const flags = mapped && mapped.truncated && typeof mapped.truncated === 'object' ? mapped.truncated : {}
  return !!(flags.files || flags.includes || flags.defines || flags.include_edges || flags.functions)
}

export function createMapView(React, t, post) {
  return function MapView(props) {
    const el = React.createElement
    const cwd = sessionCwd(props)
    const [keil, setKeil] = React.useState({ project: '', target: '' })
    const [mapped, setMapped] = React.useState(null)
    const [error, setError] = React.useState('')
    const [busy, setBusy] = React.useState(false)

    React.useEffect(() => {
      let stop = false
      function pull() {
        if (!cwd) {
          setKeil({ project: '', target: '' })
          setMapped(null)
          return
        }
        post('/dsh-vision-bench/state', { cwd }).then((data) => {
          if (stop) return
          if (data && data.ok === false) {
            setError(data.error || t('loadFail'))
            return
          }
          const next = data && data.workspace && data.workspace.keil ? data.workspace.keil : {}
          const project = next.project || ''
          const target = next.target || ''
          setKeil((prev) => (prev.project === project && prev.target === target ? prev : { project, target }))
        }).catch((err) => {
          if (!stop) setError(String((err && err.message) || t('loadFail')))
        })
      }
      pull()
      const timer = setInterval(pull, 2000)
      return () => { stop = true; clearInterval(timer) }
    }, [cwd])

    React.useEffect(() => {
      let stop = false
      if (!cwd || !keil.project) {
        setMapped(null)
        return undefined
      }
      setBusy(true)
      setError('')
      post('/dsh-vision-bench/keil/map', { cwd, project: keil.project, target: keil.target }).then((data) => {
        if (stop) return
        if (data && data.ok === false) {
          setMapped(null)
          setError(data.error || t('loadFail'))
          return
        }
        setError('')
        setMapped(data && data.result && data.result.details ? data.result.details : null)
      }).catch((err) => {
        if (!stop) {
          setMapped(null)
          setError(String((err && err.message) || t('loadFail')))
        }
      }).finally(() => { if (!stop) setBusy(false) })
      return () => { stop = true }
    }, [cwd, keil.project, keil.target])

    const counts = mapped && mapped.counts ? mapped.counts : {}
    const groups = mapped && Array.isArray(mapped.groups) ? mapped.groups : []

    return el('div', { className: 'dvb-live dvb-map' },
      el('div', { className: 'dvb-live-head' },
        el('span', { className: 'dvb-live-title' }, t('projectMap')),
        mapped ? el('span', { className: 'dvb-map-meta' },
          (mapped.target || '') + ' · ' + String(counts.files || 0)) : null),
      !cwd
        ? el('div', { className: 'dvb-hint' }, t('needWorkspace'))
        : (!keil.project
          ? el('div', { className: 'dvb-hint' }, t('projectMapEmpty'))
          : null),
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      mapped && truncated(mapped) ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('mapTruncated')) : null,
      busy ? el('div', { className: 'dvb-hint' }, t('opening')) : null,
      mapped && Array.isArray(mapped.includes) && mapped.includes.length
        ? el('div', { className: 'dvb-map-block' },
          el('div', { className: 'dvb-map-label' }, t('mapIncludes')),
          mapped.includes.map((item, index) => el('div', {
            key: 'i' + index,
            className: 'dvb-map-path',
            'data-kind': item.exists ? (item.inside ? 'ok' : 'out') : 'missing',
          }, item.path)))
        : null,
      mapped && Array.isArray(mapped.defines) && mapped.defines.length
        ? el('div', { className: 'dvb-map-block' },
          el('div', { className: 'dvb-map-label' }, t('mapDefines')),
          el('div', { className: 'dvb-map-defs' }, mapped.defines.join(', ')))
        : null,
      mapped && Array.isArray(mapped.include_edges) && mapped.include_edges.length
        ? el('div', { className: 'dvb-map-block' },
          el('div', { className: 'dvb-map-label' }, t('mapIncludesOf') + ' · ' + String(counts.include_edges || mapped.include_edges.length)),
          mapped.include_edges.slice(0, 80).map((edge, index) => el('div', {
            key: 'e' + index,
            className: 'dvb-map-path',
            'data-kind': edge.resolved ? 'ok' : 'missing',
          }, (edge.from || '') + ' → ' + (edge.to || edge.name || ''))))
        : null,
      groups.map((group, gi) => el('div', { key: 'g' + gi, className: 'dvb-map-group' },
        el('div', { className: 'dvb-map-group-name' },
          (group.name || '') + ' · ' + String((group.files || []).length)),
        (group.files || []).map((file, fi) => {
          const mark = fileMark(t, file)
          return el('div', { key: 'f' + fi },
            el('div', {
              className: 'dvb-map-file',
              'data-kind': !file.inside ? 'out' : (!file.exists ? 'missing' : (!file.readable ? 'unread' : 'ok')),
              title: file.rel || file.name,
            },
              el('span', { className: 'dvb-map-file-name' }, file.name),
              mark ? el('span', { className: 'dvb-map-file-mark' }, mark) : null),
            file.functions && file.functions.length
              ? el('div', { className: 'dvb-map-funcs' },
                t('mapFunctions') + ': ' + file.functions.map((fn) => fn.name).join(', '))
              : null)
        }))))
  }
}

export function registerMap(ctx, React, t, MapPage) {
  const bs = ctx.betterSidebar
  return bs.registerTab({
    id: TAB_MAP,
    title() { return t('projectMap') },
    single: true,
    order: 69,
    component: MapPage,
  })
}

export function openProjectTab(ctx) {
  const bs = getBetterSidebar(ctx)
  if (bs && typeof bs.openTab === 'function') bs.openTab({ type: TAB_MAP })
}
