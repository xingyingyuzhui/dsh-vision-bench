import { addSegment, defaultSegmentName, functionTag, removeSegment } from './bench-points.mjs'
import { addDevice, normalizeModbus, patchActiveDevice, recipePair, removeDevice } from './bench-devices.mjs'
import { statusKind } from './bench-settings.mjs'

function formatPointValue(item) {
  if (!item || item.value === null || item.value === undefined) return '—'
  if (typeof item.value === 'boolean') return item.value ? '1' : '0'
  return String(item.value)
}

function pickModbus(modbus, patch) {
  if (patch && Array.isArray(patch.devices)) return normalizeModbus(patch)
  if (patch && patch.activeId && Object.keys(patch).length === 1) {
    return normalizeModbus({ ...modbus, activeId: patch.activeId })
  }
  return patchActiveDevice(modbus, patch || {})
}

function fnOptionLabel(t, fn) {
  if (fn === 1) return t('fnCoil')
  if (fn === 2) return t('fnDiscrete')
  if (fn === 4) return t('fnInput')
  return t('fnHolding')
}

export function createHmiView(React, t, post, openLive) {
  return function HmiView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = (props && props.sessionId) || ''
    const [health, setHealth] = React.useState({})
    const [workspace, setWorkspace] = React.useState(emptyWorkspace)
    const [journal, setJournal] = React.useState(emptyJournal)
    const [busy, setBusy] = React.useState('')
    const [error, setError] = React.useState('')
    const [draft, setDraft] = React.useState({ name: '', function: 3, address: 0, count: 10 })
    const [ports, setPorts] = React.useState([])
    const [scanning, setScanning] = React.useState(false)
    const workspaceRef = React.useRef(workspace)
    const persistSeq = React.useRef(0)
    workspaceRef.current = workspace

    function scanPorts() {
      setScanning(true)
      post('/dsh-vision-bench/serial/ports', {}, 30000).then((data) => {
        setPorts((data && Array.isArray(data.ports)) ? data.ports : [])
      }).catch(() => {
        setPorts([])
      }).finally(() => setScanning(false))
    }

    React.useEffect(() => {
      scanPorts()
    }, [cwd])

    React.useEffect(() => {
      let stop = false
      function pull(first) {
        const seq = persistSeq.current
        post('/dsh-vision-bench/state', { cwd: cwd || '' }).then((data) => {
          if (stop) return
          if (data && data.health) setHealth(data.health)
          setJournal(pickJournal(data))
          if (seq !== persistSeq.current) return
          if (data && data.workspace && data.workspace.modbus) {
            if (first) {
              workspaceRef.current = data.workspace
              setWorkspace(data.workspace)
            } else {
              setWorkspace((prev) => {
                const next = { ...prev, modbus: data.workspace.modbus || prev.modbus }
                workspaceRef.current = next
                return next
              })
            }
          }
        }).catch((err) => {
          if (first && !stop) setError(String((err && err.message) || t('loadFail')))
        })
      }
      pull(true)
      const timer = setInterval(() => pull(false), POLL_MS)
      return () => { stop = true; clearInterval(timer) }
    }, [cwd])

    function setModbus(patch) {
      setWorkspace((prev) => {
        const next = { ...prev, modbus: { ...prev.modbus, ...patch } }
        workspaceRef.current = next
        return next
      })
    }

    function persist(patch) {
      if (!cwd) return Promise.resolve()
      const seq = ++persistSeq.current
      const modbus = pickModbus(workspaceRef.current.modbus, patch)
      const next = { ...workspaceRef.current, modbus }
      workspaceRef.current = next
      setWorkspace(next)
      return post('/dsh-vision-bench/workspace', { cwd, modbus }).then((data) => {
        if (seq !== persistSeq.current) return
        if (data && data.workspace && data.workspace.modbus) {
          const saved = { ...workspaceRef.current, modbus: data.workspace.modbus }
          workspaceRef.current = saved
          setWorkspace(saved)
        }
        if (data) setJournal(pickJournal(data))
      })
    }

    function field(label, control) {
      return el('div', { className: 'dvb-row' },
        el('div', { className: 'dvb-label' }, el('span', null, label)),
        control)
    }

    function showLive() {
      if (typeof openLive === 'function') openLive()
    }

    function toggleSim() {
      const on = !m.sim
      const patch = { sim: on }
      if (on && !(m.segments && m.segments.length)) {
        const added = addSegment([], { name: t('simName'), function: 3, address: 0, count: 10 })
        if (added.ok) patch.segments = added.segments
      }
      if (on && m.role === 'slave') patch.listen = true
      setError('')
      persist(patch)
      if (on) showLive()
    }

    function addRange() {
      const added = addSegment(m.segments, draft)
      if (!added.ok) {
        setError(added.error)
        return
      }
      setError('')
      persist({ segments: added.segments })
    }

    function dropRange(id) {
      const next = removeSegment(m.segments, m.values, id)
      persist({ segments: next.segments, values: next.values })
    }

    function readRanges(segmentId) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return
      }
      setBusy(segmentId || 'read')
      setError('')
      persist({}).then(() => post('/dsh-vision-bench/modbus/read', {
        cwd,
        source: 'user',
        sessionId,
        deviceId: m.id,
        all: !segmentId,
        segmentId: segmentId || undefined,
      }, 120000)).then((data) => {
        if (!data) return
        if (Array.isArray(data.values)) setModbus({ values: data.values })
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setModbus({
            segments: data.workspace.modbus.segments,
            values: data.workspace.modbus.values,
          })
        }
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      }).finally(() => setBusy(''))
    }

    const pythonReady = statusKind(health.python) === 'ready'
    const pack = normalizeModbus(workspace.modbus)
    const m = pack
    const devices = pack.devices
    const hasDevices = devices.length > 0
    const isSlave = m.role === 'slave'
    const sim = m.sim === true
    const canDevice = sim || pythonReady || isSlave
    const segments = Array.isArray(m.segments) ? m.segments : []
    const readRunning = runningOf(journal, 'read')
    const readBusy = !!busy || readRunning
    const connMissing = sim ? false : (m.mode === 'tcp' ? !m.host : !m.port)
    const readBlock = !cwd
      ? t('needWorkspace')
      : (!hasDevices
        ? t('emptyDevices')
        : (!canDevice
          ? t('needBindingsRead')
          : (connMissing
            ? (m.mode === 'tcp' ? t('needHost') : t('needSerial'))
            : (segments.length ? '' : t('needSegments')))))
    const readAllLabel = busy === 'read' || (readRunning && !busy)
      ? (readRunning && runningSource(journal, 'read') === 'agent' ? t('agentReading') : t('reading'))
      : t('readAll')
    const watching = !!(m.polling && m.polling.enabled)

    const tableRows = segments.map((segment) => el('tr', { key: segment.id, 'data-kind': 'seg' },
      el('td', null, segment.name || defaultSegmentName(segment)),
      el('td', null, functionTag(segment.function)),
      el('td', { className: 'dvb-val' }, String(segment.address) + '–' + String(segment.address + segment.count - 1)),
      el('td', { className: 'dvb-val' }, String(segment.count)),
      el('td', null,
        el('div', { className: 'dvb-seg-actions' },
          el('button', {
            type: 'button', className: 'dvb-btn',
            disabled: !cwd || !canDevice || connMissing || readBusy,
            onClick() { readRanges(segment.id) },
          }, busy === segment.id ? t('reading') : t('readSegment')),
          el('button', {
            type: 'button', className: 'dvb-btn', disabled: !!busy,
            onClick() { dropRange(segment.id) },
          }, t('deleteSegment'))))))

    const deviceBar = el('div', { className: 'dvb-devbar' + (hasDevices ? '' : ' is-empty') },
      devices.map((item) => el('button', {
        key: item.id,
        type: 'button',
        className: 'dvb-dev' + (item.id === m.activeId ? ' is-on' : ''),
        title: (item.name || t('unnamed')) + ' · ' + (item.role === 'slave' ? t('roleSlave') : t('roleMaster')),
        onClick() { persist({ activeId: item.id }) },
      },
        el('span', { className: 'dvb-dev-name' }, item.name || t('unnamed')),
        el('span', { className: 'dvb-dev-meta' },
          (item.role === 'slave' ? t('roleSlave') : t('roleMaster'))
          + (item.sim ? ' · ' + t('sim') : '')
          + (item.role === 'slave' && item.listen ? ' · ' + t('listen') : '')))),
      el('div', { className: 'dvb-devbar-add' },
        el('button', {
          type: 'button', className: 'dvb-btn', disabled: !cwd,
          onClick() {
            const added = addDevice(workspace.modbus, { role: 'master', name: t('roleMaster') })
            if (!added.ok) setError(added.error)
            else persist(added.modbus)
          },
        }, t('addMaster')),
        el('button', {
          type: 'button', className: 'dvb-btn', disabled: !cwd,
          onClick() {
            const added = addDevice(workspace.modbus, { role: 'slave', name: t('roleSlave'), mode: 'tcp', sim: true, listen: true })
            if (!added.ok) setError(added.error)
            else persist(added.modbus)
          },
        }, t('addSlave')),
        el('button', {
          type: 'button', className: 'dvb-btn', disabled: !cwd, title: t('recipeTitle'),
          onClick() { persist(recipePair()); showLive() },
        }, t('recipePair'))))

    const connPanel = hasDevices ? el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('connection')),
        sim ? el('span', { className: 'dvb-tag' }, t('sim')) : null,
        isSlave && m.listen ? el('span', { className: 'dvb-tag' }, t('listen')) : null,
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (sim ? ' is-on' : ''),
          disabled: !cwd,
          title: t('simHint'),
          onClick: toggleSim,
        }, t('sim')),
        isSlave
          ? el('button', {
            type: 'button',
            className: 'dvb-btn' + (m.listen ? ' is-on' : ''),
            disabled: !cwd,
            onClick() { persist({ listen: !m.listen, mode: 'tcp' }) },
          }, t('listen'))
          : null,
        el('button', {
          type: 'button', className: 'dvb-btn', disabled: !cwd,
          onClick() { persist(removeDevice(workspace.modbus, m.id)) },
        }, t('removeDevice'))),
      el('div', { className: 'dvb-conn' },
        field(t('deviceName'), el('input', {
          className: 'dvb-input',
          value: m.name || '',
          onChange(event) { persist({ name: event.target.value }) },
        })),
        field(t('role'), el('select', {
          className: 'dvb-input',
          value: isSlave ? 'slave' : 'master',
          onChange(event) { persist({ role: event.target.value }) },
        },
          el('option', { value: 'master' }, t('roleMaster')),
          el('option', { value: 'slave' }, t('roleSlave')))),
        field(t('mode'), el('select', {
          className: 'dvb-input',
          value: m.mode,
          onChange(event) { persist({ mode: event.target.value }) },
        },
          el('option', { value: 'rtu' }, 'RTU'),
          el('option', { value: 'tcp' }, 'TCP'))),
        m.mode === 'rtu'
          ? field(t('serial'), el('div', { className: 'dvb-combo' },
            el('select', {
              className: 'dvb-input dvb-input-mono',
              value: m.port || '',
              disabled: scanning,
              onChange(event) { persist({ port: event.target.value }) },
            },
              el('option', { value: '' }, scanning ? t('serialScanning') : (ports.length ? t('serialPick') : t('serialNone'))),
              m.port && !ports.some((item) => item.path === m.port)
                ? el('option', { value: m.port }, m.port + ' · ' + t('serialGone'))
                : null,
              ports.map((item) => el('option', { key: item.path, value: item.path }, item.label || item.path))),
            el('button', {
              type: 'button',
              className: 'dvb-btn',
              disabled: scanning,
              title: t('serialScan'),
              onClick: scanPorts,
            }, t('serialScan'))))
          : field(t('host'), el('input', {
            className: 'dvb-input dvb-input-mono',
            value: m.host || '',
            title: t('hostPh'),
            spellCheck: false,
            autoComplete: 'off',
            onChange(event) { persist({ host: event.target.value }) },
          })),
        m.mode === 'rtu'
          ? field(t('baudrate'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', value: m.baudrate,
            onChange(event) { persist({ baudrate: Number(event.target.value) }) },
          }))
          : field(t('tcpPort'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', value: m.tcpPort,
            onChange(event) { persist({ tcpPort: Number(event.target.value) }) },
          })),
        field(t('slave'), el('input', {
          className: 'dvb-input dvb-input-mono', type: 'number', value: m.slave, min: 1, max: 247,
          onChange(event) { persist({ slave: Number(event.target.value) }) },
        })))) : el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-empty' }, t('emptyDevices')))

    const segPanel = hasDevices ? el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('segments')),
        el('button', {
          type: 'button',
          className: 'dvb-btn',
          disabled: !cwd || !canDevice || connMissing || !segments.length || readBusy,
          onClick() { readRanges() },
        }, readAllLabel),
        el('button', {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary' + (watching ? ' is-on' : ''),
          disabled: !cwd || !canDevice || connMissing || !segments.length,
          onClick() {
            persist({ polling: { enabled: !watching, intervalMs: (m.polling && m.polling.intervalMs) || 1000 } })
            if (!watching) showLive()
          },
        }, watching ? t('liveStop') : t('liveStart')),
        !readBusy && readBlock ? el('span', { className: 'dvb-need' }, readBlock) : null),
      el('div', { className: 'dvb-seg-add' },
        field(t('segmentName'), el('input', {
          className: 'dvb-input',
          value: draft.name,
          onChange(event) { setDraft((prev) => ({ ...prev, name: event.target.value })) },
        })),
        field(t('function'), el('select', {
          className: 'dvb-input',
          value: String(draft.function),
          onChange(event) { setDraft((prev) => ({ ...prev, function: Number(event.target.value) })) },
        },
          el('option', { value: '1' }, fnOptionLabel(t, 1)),
          el('option', { value: '2' }, fnOptionLabel(t, 2)),
          el('option', { value: '3' }, fnOptionLabel(t, 3)),
          el('option', { value: '4' }, fnOptionLabel(t, 4)))),
        field(t('startAddr'), el('input', {
          className: 'dvb-input dvb-input-mono', type: 'number', value: draft.address,
          onChange(event) { setDraft((prev) => ({ ...prev, address: Number(event.target.value) })) },
        })),
        field(t('quantity'), el('input', {
          className: 'dvb-input dvb-input-mono', type: 'number', value: draft.count, min: 1, max: 125,
          onChange(event) { setDraft((prev) => ({ ...prev, count: Number(event.target.value) })) },
        })),
        field('\u00a0', el('button', { type: 'button', className: 'dvb-btn', disabled: !cwd || !!busy, onClick: addRange }, t('addSegment')))),
      segments.length
        ? el('div', { className: 'dvb-table-wrap' },
          el('table', { className: 'dvb-table' },
            el('thead', null, el('tr', null,
              el('th', null, t('colName')),
              el('th', null, t('colFn')),
              el('th', null, t('colAddr')),
              el('th', null, t('quantity')),
              el('th', null, ''))),
            el('tbody', null, tableRows)))
        : el('div', { className: 'dvb-empty' }, t('emptySegments')),
      el('div', { className: 'dvb-hint' }, t('pointsHint'))) : null

    return el('div', { className: 'dvb-page' },
      statusBar(el, t, cwd, [{ key: 'python', health: health.python }]),
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      deviceBar,
      connPanel,
      segPanel,
      journalPanel(el, t, journal))
  }
}
