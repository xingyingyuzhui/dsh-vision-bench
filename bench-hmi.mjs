import { addSegment, csvToSegments, defaultSegmentName, functionTag, isWritableFunction, normalizeWriteValues, removeSegment, segmentsToCsv, writeTargetOf } from './bench-points.mjs'
import { addDevice, normalizeModbus, patchActiveDevice, recipePair, removeDevice } from './bench-devices.mjs'
import {
  clearFramesLog,
  clockOf,
  getFramesLog,
  lineKind,
  pushFramesLog,
} from './bench-shared.mjs'
import {
  emptyJournal,
  emptyWorkspace,
  journalPanel,
  pickJournal,
  runningOf,
  runningSource,
  statusBar,
  subscribeState,
  useSessionCwd,
} from './bench-shared.mjs'
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
  const key = fn === 1 ? 'fnCoil' : fn === 2 ? 'fnDiscrete' : fn === 4 ? 'fnInput' : 'fnHolding'
  return t(key) + (isWritableFunction(fn) ? ' ' + t('writableTag') : '')
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
    const [writeState, setWriteState] = React.useState(null)
    const [csvOpen, setCsvOpen] = React.useState(false)
    const [csvText, setCsvText] = React.useState('')
    const [csvNote, setCsvNote] = React.useState('')
    const [pending, setPending] = React.useState([])
    const [serial, setSerial] = React.useState({ open: false, port: '', baudrate: 115200, lines: [], filter: '', paused: false, error: '', lastId: 0 })
    const [logMode, setLogMode] = React.useState('serial')
    const [copiedSerial, setCopiedSerial] = React.useState(false)
    const serialRef = React.useRef(serial)
    serialRef.current = serial
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
      if (!cwd || !serial.open) return undefined
      let stop = false
      const timer = setInterval(() => {
        post('/dsh-vision-bench/serial/feed', { cwd, since: serialRef.current.lastId }, 10000).then((data) => {
          if (stop || !data) return
          setSerial((prev) => ({
            ...prev,
            open: data.open !== false,
            error: data.error || '',
            lastId: data.lastId || prev.lastId,
            lines: Array.isArray(data.lines) && data.lines.length
              ? prev.lines.concat(data.lines).slice(-1000)
              : prev.lines,
          }))
        }).catch(() => { /* next tick retries */ })
      }, 700)
      return () => { stop = true; clearInterval(timer) }
    }, [cwd, serial.open])

    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (!data) return
      const seq = persistSeq.current
      if (data.health) setHealth(data.health)
      if (Array.isArray(data.pendingWrites)) setPending(data.pendingWrites)
      setJournal(pickJournal(data))
      if (seq !== persistSeq.current) return
      if (data.workspace && data.workspace.modbus) {
        setWorkspace((prev) => {
          const next = { ...prev, modbus: data.workspace.modbus || prev.modbus }
          workspaceRef.current = next
          return next
        })
      }
    }), [cwd, post])

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

    function resolveWrite(id, approved) {
      post('/dsh-vision-bench/modbus/write/approve', { cwd, id, approved }, 120000).then((data) => {
        setPending((prev) => prev.filter((item) => item.id !== id))
        if (data && data.ok === false && !data.rejected) setError(data.error || t('fail'))
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
      })
    }

    const pendingPanel = pending.length
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-panel-head' },
          el('span', { className: 'dvb-panel-title' }, t('pendingWrites'))),
        pending.map((req) => el('div', { key: req.id, className: 'dvb-task' },
          el('span', { className: 'dvb-badge', 'data-source': 'agent' }, 'Agent'),
          el('span', { className: 'dvb-hint' }, req.label
            + (req.deviceName ? ' · ' + req.deviceName : '')
            + (req.endpointLabelStr ? ' · ' + req.endpointLabelStr : '')),
          el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
            onClick() { resolveWrite(req.id, true) },
          }, t('approveWrite')),
          el('button', {
            type: 'button', className: 'dvb-btn',
            onClick() { resolveWrite(req.id, false) },
          }, t('rejectWrite')))))
      : null

    function openSerial() {
      if (!cwd) return
      post('/dsh-vision-bench/serial/open', {
        cwd,
        port: serial.port,
        baudrate: Number(serial.baudrate) || 115200,
      }, 15000).then((data) => {
        if (!data || data.ok === false) {
          setSerial((prev) => ({ ...prev, error: (data && data.error) || t('fail') }))
          return
        }
        setSerial((prev) => ({ ...prev, open: true, error: '', lines: [], lastId: 0 }))
      }).catch((err) => {
        setSerial((prev) => ({ ...prev, error: String((err && err.message) || t('fail')) }))
      })
    }

    function closeSerial() {
      if (!cwd) return
      post('/dsh-vision-bench/serial/close', { cwd }, 10000).catch(() => { /* ignore */ })
      setSerial((prev) => ({ ...prev, open: false, lines: [], lastId: 0, error: '' }))
    }

    function copySerial() {
      const filterText = serial.filter.trim().toLowerCase()
      const visible = filterText
        ? serial.lines.filter((item) => item.line.toLowerCase().includes(filterText))
        : serial.lines
      const text = visible.map((item) => '[' + clockOf(item.t) + '] ' + item.line).join('\n')
      if (!text) return
      navigator.clipboard.writeText(text).then(() => {
        setCopiedSerial(true)
        setTimeout(() => setCopiedSerial(false), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function exportCsv() {
      navigator.clipboard.writeText(segmentsToCsv(m.segments)).then(() => {
        setCsvNote(t('csvDone'))
        setTimeout(() => setCsvNote(''), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function importCsv() {
      const parsed = csvToSegments(csvText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      setError('')
      setCsvOpen(false)
      setCsvText('')
      persist({ segments: parsed.segments, values: [] })
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
        pushFramesLog(cwd, data.framesLog)
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

    function openWrite(segment) {
      setError('')
      setWriteState({
        segmentId: segment.id,
        address: segment.address,
        qty: 1,
        text: '',
        busy: false,
        result: null,
      })
    }

    function closeWrite() {
      setWriteState(null)
    }

    function patchWrite(patch) {
      setWriteState((prev) => ({ ...prev, ...patch }))
    }

    function submitWrite() {
      const seg = segments.find((item) => item.id === writeState.segmentId)
      if (!seg || !cwd) return
      const last = seg.address + seg.count - 1
      const qty = Math.max(1, Math.min(Number(writeState.qty) || 1, seg.count))
      const address = Math.max(seg.address, Math.min(Number(writeState.address) || seg.address, last - qty + 1))
      if (address + qty - 1 > last) {
        patchWrite({ result: { ok: false, error: t('writeRangeErr') } })
        return
      }
      let values
      if (qty === 1 && writeTargetOf(seg.function).kind === 'coil') {
        values = [Number(writeState.text) ? 1 : 0]
      } else {
        values = String(writeState.text || '').split(',').map((part) => part.trim()).filter(Boolean).map(Number)
      }
      const check = normalizeWriteValues(seg.function, values, qty)
      if (!check.ok) {
        patchWrite({ result: { ok: false, error: check.error } })
        return
      }
      patchWrite({ busy: true, result: null })
      post('/dsh-vision-bench/modbus/write', {
        cwd,
        source: 'user',
        sessionId,
        deviceId: m.id,
        function: seg.function,
        address,
        values,
      }, 60000).then((data) => {
        patchWrite({ busy: false, result: data })
        pushFramesLog(cwd, (data && data.framesLog) || [])
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
        patchWrite({ busy: false, result: { ok: false, error: String((err && err.message) || t('fail')) } })
      })
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
          isWritableFunction(segment.function)
            ? el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-write' + (writeState && writeState.segmentId === segment.id ? ' is-on' : ''),
              disabled: !cwd || !canDevice || connMissing || !!busy,
              title: t('writeTitle'),
              onClick() { openWrite(segment) },
            }, t('writeSegment'))
            : null,
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
        isSlave && m.listening ? el('span', { className: 'dvb-tag' }, t('listen')) : null,
        isSlave && m.listen && !m.listening ? el('span', { className: 'dvb-need' }, m.listenError || t('listenFail')) : null,
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
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: !segments.length,
          title: t('csvReplaceHint'),
          onClick: exportCsv,
        }, csvNote || t('csvExport')),
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (csvOpen ? ' is-on' : ''),
          disabled: !cwd,
          onClick() { setCsvOpen((prev) => !prev) },
        }, t('csvImport')),
        !readBusy && readBlock ? el('span', { className: 'dvb-need' }, readBlock) : null),
      csvOpen
        ? el('div', { className: 'dvb-write-panel' },
          el('div', { className: 'dvb-hint' }, t('csvReplaceHint')),
          el('textarea', {
            className: 'dvb-input dvb-csv-area',
            value: csvText,
            rows: 5,
            spellCheck: false,
            placeholder: 'name,function,address,count,scale,offset,unit,alarmMin,alarmMax',
            onChange(event) { setCsvText(event.target.value) },
          }),
          el('div', { className: 'dvb-actions' },
            el('button', {
              type: 'button', className: 'dvb-btn dvb-btn-primary',
              disabled: !csvText.trim(),
              onClick: importCsv,
            }, t('csvApply')),
            el('button', {
              type: 'button', className: 'dvb-btn',
              onClick() { setCsvOpen(false) },
            }, t('csvCancel'))))
        : null,
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

    const writeSeg = writeState ? segments.find((item) => item.id === writeState.segmentId) : null
    const writeTarget = writeSeg ? writeTargetOf(writeSeg.function) : null
    const writeQty = writeState ? Math.max(1, Math.min(Number(writeState.qty) || 1, writeSeg.count)) : 1
    const writeResultLine = (result) => {
      if (!result) return null
      if (result.ok === false) {
        return el('div', { className: 'dvb-write-result', 'data-kind': 'err' }, result.error || t('fail'))
      }
      const parts = (result.target || []).map((tv, i) => {
        const before = result.before && result.before[i] !== null && result.before[i] !== undefined
          ? String(result.before[i])
          : '—'
        const back = result.readback && result.readback[i] !== undefined ? String(result.readback[i]) : '—'
        return functionTag(result.function) + (result.address + i) + ': '
          + before + ' → ' + String(tv) + ' → ' + back
      })
      return el('div', { className: 'dvb-write-result', 'data-kind': result.ok ? 'ok' : 'err' },
        parts.join('；'),
        el('span', { className: 'dvb-write-note' }, result.summary || ''))
    }
    const writePanel = writeState && writeSeg && writeTarget
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-panel-head' },
          el('span', { className: 'dvb-panel-title' }, t('writeTitle') + ' · ' + (writeSeg.name || defaultSegmentName(writeSeg))),
          el('button', {
            type: 'button', className: 'dvb-btn',
            disabled: writeState.busy,
            onClick: closeWrite,
          }, t('writeClose'))),
        el('div', { className: 'dvb-seg-add' },
          field(t('writeAddr'), el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            value: writeState.address,
            min: writeSeg.address,
            max: writeSeg.address + writeSeg.count - 1,
            disabled: writeState.busy,
            onChange(event) { patchWrite({ address: Number(event.target.value) }) },
          })),
          field(t('quantity'), el('input', {
            className: 'dvb-input dvb-input-mono',
            type: 'number',
            value: writeQty,
            min: 1,
            max: writeSeg.count,
            disabled: writeState.busy,
            onChange(event) { patchWrite({ qty: Number(event.target.value) }) },
          })),
          writeQty === 1 && writeTarget.kind === 'coil'
            ? field(t('writeValue'), el('select', {
              className: 'dvb-input',
              value: String(Number(writeState.text) ? 1 : 0),
              disabled: writeState.busy,
              onChange(event) { patchWrite({ text: event.target.value }) },
            },
              el('option', { value: '0' }, t('coilOff')),
              el('option', { value: '1' }, t('coilOn'))))
            : field(writeQty === 1 ? t('writeValue') : t('writeValuesCsv'), el('input', {
              className: 'dvb-input dvb-input-mono',
              value: writeState.text,
              placeholder: writeQty === 1 ? '' : '1,0,1',
              disabled: writeState.busy,
              spellCheck: false,
              autoComplete: 'off',
              onChange(event) { patchWrite({ text: event.target.value }) },
              onKeyDown(event) {
                if (event.key === 'Enter' && !writeState.busy) submitWrite()
              },
            })),
          field('\u00a0', el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
            disabled: !cwd || !canDevice || connMissing || writeState.busy,
            onClick: submitWrite,
          }, writeState.busy ? t('writing') : t('writeConfirm')))),
        writeResultLine(writeState.result))
      : null

    const serialFilterText = serial.filter.trim().toLowerCase()
    const serialLines = serialFilterText
      ? serial.lines.filter((item) => item.line.toLowerCase().includes(serialFilterText))
      : serial.lines
    const framesAll = getFramesLog(cwd)
    const frameRows = framesAll.map((item) => ({
      t: item.t,
      tx: '\u2192 ' + (item.request || '(\u65e0\u5e27)') + ' \u00b7 ' + item.label + (item.deviceName ? ' \u00b7 ' + item.deviceName : ''),
      rx: item.response ? '\u2190 ' + item.response : '',
    }))
    const visibleFrameRows = serialFilterText
      ? frameRows.filter((item) => (item.tx + item.rx).toLowerCase().includes(serialFilterText))
      : frameRows

    function copyLogText() {
      const text = logMode === 'serial'
        ? serialLines.map((item) => '[' + clockOf(item.t) + '] ' + item.line).join('\n')
        : visibleFrameRows.map((item) => '[' + clockOf(item.t) + '] ' + item.tx + (item.rx ? '\n  ' + item.rx : '')).join('\n')
      if (!text) return
      navigator.clipboard.writeText(text).then(() => {
        setCopiedSerial(true)
        setTimeout(() => setCopiedSerial(false), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function logBody() {
      if (logMode === 'frames') {
        if (!visibleFrameRows.length) return el('div', { className: 'dvb-empty' }, t('framesEmpty'))
        return el('pre', {
          className: 'dvb-log dvb-serial-log',
          ref: (node) => {
            if (node && !serial.paused) node.scrollTop = node.scrollHeight
          },
        }, visibleFrameRows.map((item, idx) => el('div', {
          key: item.t + ':' + idx,
          className: 'dvb-serial-line',
        },
          '[' + clockOf(item.t) + '] ' + item.tx,
          item.rx ? el('div', null, '  ' + item.rx) : null)))
      }
      if (!serialLines.length) return el('div', { className: 'dvb-empty' }, t('serialEmpty'))
      return el('pre', {
        className: 'dvb-log dvb-serial-log',
        ref: (node) => {
          if (node && !serial.paused) node.scrollTop = node.scrollHeight
        },
      }, serialLines.map((item) => el('div', {
        key: item.id,
        className: 'dvb-serial-line',
        'data-kind': lineKind(item.line),
      }, '[' + clockOf(item.t) + '] ' + item.line)))
    }

    const serialPanel = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, logMode === 'frames' ? t('framesTitle') : t('serialTitle')),
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (logMode === 'serial' ? ' is-on' : ''),
          onClick() { setLogMode('serial') },
        }, t('logTabSerial')),
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (logMode === 'frames' ? ' is-on' : ''),
          onClick() { setLogMode('frames') },
        }, t('logTabFrames')),
        logMode === 'frames'
          ? el('button', {
            type: 'button', className: 'dvb-btn',
            onClick() { clearFramesLog(cwd) },
          }, t('framesClear'))
          : null,
        el('div', { style: { flex: 1 } }),
        logMode === 'serial'
          ? el('span', { className: 'dvb-live-dot', 'data-kind': serial.open ? (serial.error ? 'err' : 'live') : 'idle' })
          : null,
        logMode === 'serial' && serial.open && serial.port ? el('span', { className: 'dvb-map-meta' }, serial.port + ' @ ' + serial.baudrate) : null,
        logMode === 'serial' && serial.error ? el('span', { className: 'dvb-need' }, serial.error) : null,
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: logMode === 'serial'
            ? (!serial.open || !serialLines.length)
            : (!frameRows.length),
          onClick: copyLogText,
        }, copiedSerial ? t('serialCopied') : t('serialCopy')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: logMode === 'serial' && !serial.open,
          onClick() { setSerial((prev) => ({ ...prev, paused: !prev.paused })) },
        }, serial.paused ? t('serialResume') : t('serialPause'))),
      el('div', { className: 'dvb-toolbar' },
        field(t('serial'), el('div', { className: 'dvb-combo' },
          el('select', {
            className: 'dvb-input dvb-input-mono',
            value: serial.port,
            disabled: scanning || serial.open,
            onChange(event) { setSerial((prev) => ({ ...prev, port: event.target.value })) },
          },
            el('option', { value: '' }, scanning ? t('serialScanning') : (ports.length ? t('serialPick') : t('serialNone'))),
            serial.port && !ports.some((item) => item.path === serial.port)
              ? el('option', { value: serial.port }, serial.port + ' · ' + t('serialGone'))
              : null,
            ports.map((item) => el('option', { key: item.path, value: item.path }, item.label || item.path))),
          el('button', {
            type: 'button', className: 'dvb-btn',
            disabled: scanning || serial.open,
            title: t('serialScan'),
            onClick: scanPorts,
          }, t('serialScan')))),
        field(t('baud'), el('input', {
          className: 'dvb-input dvb-input-mono',
          type: 'number',
          value: serial.baudrate,
          disabled: serial.open,
          onChange(event) { setSerial((prev) => ({ ...prev, baudrate: Number(event.target.value) })) },
        })),
        field('\u00a0', serial.open
          ? el('button', { type: 'button', className: 'dvb-btn', onClick: closeSerial }, t('serialClose'))
          : el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary',
            disabled: !cwd || !serial.port,
            onClick: openSerial,
          }, t('serialOpen')))),
      field(t('serialFilter'), el('input', {
        className: 'dvb-input',
        value: serial.filter,
        placeholder: 'error, assert…',
        spellCheck: false,
        autoComplete: 'off',
        onChange(event) { setSerial((prev) => ({ ...prev, filter: event.target.value })) },
      })),
      logBody())


    return el('div', { className: 'dvb-page' },
      statusBar(el, t, cwd, [{ key: 'python', health: health.python }]),
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      deviceBar,
      connPanel,
      pendingPanel,
      segPanel,
      writePanel,
      serialPanel,
      journalPanel(el, t, journal))
  }
}
