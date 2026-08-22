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
import { connLabel } from './bench-devices.mjs'
import {
  csvToPoints,
  decodeValue,
  functionTag,
  isWritableFunction,
  normalizeWriteValues,
  pointsToCsv,
} from './bench-points.mjs'

const POLL_INTERVALS = [500, 1000, 2000, 5000]

function fnOptionLabel(t, fn) {
  const key = fn === 1 ? 'fnCoil' : fn === 2 ? 'fnDiscrete' : fn === 4 ? 'fnInput' : 'fnHolding'
  return t(key) + (isWritableFunction(fn) ? ' ' + t('writableTag') : '')
}

function pickConn(modbus, patch) {
  return { ...modbus, conn: { ...(modbus.conn || {}), ...(patch || {}) } }
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
    const [ports, setPorts] = React.useState([])
    const [scanning, setScanning] = React.useState(false)
    const [pending, setPending] = React.useState([])
    // point form
    const [form, setForm] = React.useState({ mode: 'hidden', id: '', name: '', function: 3, address: 0, scale: 1, offset: 0, unit: '', alarmMin: '', alarmMax: '' })
    const [batch, setBatch] = React.useState({ open: false, prefix: '', fc: 3, start: 0, count: 5 })
    // inline write strip: {pointId, fn, address, text}
    const [writeRow, setWriteRow] = React.useState(null)
    // csv
    const [csvOpen, setCsvOpen] = React.useState(false)
    const [csvText, setCsvText] = React.useState('')
    const [csvNote, setCsvNote] = React.useState('')
    // serial log / frames dual-mode
    const [logMode, setLogMode] = React.useState('serial')
    const [serial, setSerial] = React.useState({ open: false, port: '', baudrate: 115200, lines: [], filter: '', paused: false, error: '', lastId: 0 })
    const [copiedSerial, setCopiedSerial] = React.useState(false)
    const serialRef = React.useRef(serial)
    serialRef.current = serial
    const workspaceRef = React.useRef(workspace)
    workspaceRef.current = workspace
    const inflight = React.useRef(0)

    const field = (label, control) => el('div', { className: 'dvb-row' },
      el('div', { className: 'dvb-label' }, el('span', null, label)),
      control)

    function scanPorts() {
      setScanning(true)
      post('/dsh-vision-bench/serial/ports', {}, 30000).then((data) => {
        setPorts((data && Array.isArray(data.ports)) ? data.ports : [])
      }).catch(() => setPorts([])).finally(() => setScanning(false))
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
      if (data.health) setHealth(data.health)
      if (Array.isArray(data.pendingWrites)) setPending(data.pendingWrites)
      setJournal(pickJournal(data))
      // Skip echoing server state back while one of our own writes is in flight.
      if (inflight.current > 0) return
      if (data.workspace && data.workspace.modbus) {
        setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
      }
    }), [cwd])

    function normalizePack() {
      const mb = (workspaceRef.current.modbus) || emptyWorkspace().modbus
      return mb.version === 2 ? mb : emptyWorkspace().modbus
    }

    function persist(modbusPatch) {
      if (!cwd) return Promise.resolve()
      const seq = ++inflight.current
      setWorkspace((prev) => ({
        ...prev,
        modbus: { ...prev.modbus, ...(modbusPatch.conn ? { conn: { ...prev.modbus.conn, ...modbusPatch.conn } } : {}), ...(modbusPatch.points !== undefined ? { points: modbusPatch.points } : {}), ...(modbusPatch.values !== undefined ? { values: modbusPatch.values } : {}), ...(modbusPatch.polling ? { polling: { ...prev.modbus.polling, ...modbusPatch.polling } } : {}) },
      }))
      return post('/dsh-vision-bench/workspace', { cwd, modbus: modbusPatch }).then((data) => {
        if (seq === inflight.current && data && data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus }))
          workspaceRef.current = { ...workspaceRef.current, modbus: data.workspace.modbus }
        }
        if (data) setJournal(pickJournal(data))
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      }).finally(() => {
        if (seq === inflight.current) inflight.current = 0
      })
    }

    function setConn(patch) {
      const pack = normalizePack()
      persist({ conn: { ...(pack.conn || {}), ...patch } })
    }

    // ── point form ──
    function openAddPoint() {
      setError('')
      setBatch((prev) => ({ ...prev, open: false }))
      setWriteRow(null)
      setForm({ mode: 'add', id: '', name: '', function: 3, address: 0, scale: 1, offset: 0, unit: '', alarmMin: '', alarmMax: '' })
    }

    function openEditPoint(point) {
      setError('')
      setWriteRow(null)
      setForm({
        mode: 'edit',
        id: point.id,
        name: point.name,
        function: point.function,
        address: point.address,
        scale: point.scale,
        offset: point.offset,
        unit: point.unit,
        alarmMin: point.alarmMin === null ? '' : String(point.alarmMin),
        alarmMax: point.alarmMax === null ? '' : String(point.alarmMax),
      })
    }

    function closeForm() {
      setForm((prev) => ({ ...prev, mode: 'hidden' }))
    }

    function submitPoint() {
      const pack = normalizePack()
      const fnNum = Number(form.function)
      const addrNum = Number(form.address)
      if (!Number.isFinite(addrNum) || addrNum < 0 || addrNum > 65535) {
        setError(t('ptAddr') + ' 0–65535')
        return
      }
      const dup = pack.points.some((p) => p.function === fnNum && p.address === addrNum && p.id !== form.id)
      if (dup) {
        setError('已存在相同功能码和地址的点位')
        return
      }
      const base = {
        id: 'p' + fnNum + '_' + addrNum,
        name: form.name,
        function: fnNum,
        address: addrNum,
        scale: Number(form.scale) || 1,
        offset: Number(form.offset) || 0,
        unit: form.unit,
        alarmMin: form.alarmMin === '' ? null : Number(form.alarmMin),
        alarmMax: form.alarmMax === '' ? null : Number(form.alarmMax),
      }
      let points
      if (form.mode === 'edit') {
        points = pack.points.map((p) => (p.id === form.id ? base : p))
      } else {
        if (pack.points.some((p) => p.id === base.id)) {
          setError('已存在相同功能码和地址的点位')
          return
        }
        points = pack.points.concat([base])
      }
      closeForm()
      persist({ points })
    }

    function generateBatch() {
      const pack = normalizePack()
      const count = Math.max(1, Math.min(Number(batch.count) || 1, 64))
      const existing = new Set(pack.points.map((p) => p.id))
      const additions = []
      for (let i = 0; i < count; i++) {
        const address = Number(batch.start) + i
        const id = 'p' + batch.fc + '_' + address
        if (existing.has(id)) continue
        additions.push({ id, name: (batch.prefix || '') + i, function: Number(batch.fc), address })
      }
      if (!additions.length) {
        setError('批量点位的地址全部与现有点位重复')
        return
      }
      setError('')
      setBatch((prev) => ({ ...prev, open: false }))
      persist({ points: pack.points.concat(additions) })
    }

    function removePointRow(point) {
      const pack = normalizePack()
      persist({
        points: pack.points.filter((p) => p.id !== point.id),
        values: pack.values.filter((v) => v.key !== point.id),
      })
    }

    // ── reads ──
    function readAll() {
      readOne(null)
    }

    function readOne(pointId) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return
      }
      setBusy(pointId || 'read')
      setError('')
      post('/dsh-vision-bench/modbus/read', {
        cwd,
        source: 'user',
        sessionId,
        all: !pointId,
        pointId: pointId || undefined,
      }, 120000).then((data) => {
        if (!data) return
        pushFramesLog(cwd, data.framesLog)
        if (Array.isArray(data.values)) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
          workspaceRef.current = { ...workspaceRef.current, modbus: { ...workspaceRef.current.modbus, values: data.values } }
        }
        if (data.ok === false && data.error) setError(data.error)
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.workspace.modbus.values || prev.modbus.values } }))
        }
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      }).finally(() => setBusy(''))
    }

    // ── inline write ──
    function openWriteRow(point) {
      setError('')
      setForm((prev) => ({ ...prev, mode: 'hidden' }))
      const rec = (normalizePack().values || []).find((item) => item.key === point.id)
      const current = rec && rec.raw !== null && rec.raw !== undefined ? String(rec.raw) : ''
      setWriteRow({ pointId: point.id, name: point.name, fn: point.function, address: point.address, text: current, busy: false, result: null })
    }

    function submitWriteRow() {
      const row = writeRow
      if (!row || !cwd) return
      let values
      if (row.fn === 1) values = [Number(row.text) ? 1 : 0]
      else values = Number.isFinite(Number(row.text)) ? [Number(row.text)] : [NaN]
      const check = normalizeWriteValues(row.fn, values, 1)
      if (!check.ok) {
        setWriteRow((prev) => ({ ...prev, result: { ok: false, error: check.error } }))
        return
      }
      setWriteRow((prev) => ({ ...prev, busy: true, result: null }))
      post('/dsh-vision-bench/modbus/write', {
        cwd,
        source: 'user',
        sessionId,
        function: row.fn,
        address: row.address,
        values,
      }, 60000).then((data) => {
        setWriteRow((prev) => ({ ...prev, busy: false, result: data }))
        pushFramesLog(cwd, (data && data.framesLog) || [])
        if (Array.isArray(data.values)) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.values } }))
          workspaceRef.current = { ...workspaceRef.current, modbus: { ...workspaceRef.current.modbus, values: data.values } }
        }
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: { ...prev.modbus, values: data.workspace.modbus.values || prev.modbus.values } }))
        }
      }).catch((err) => {
        setWriteRow((prev) => ({ ...prev, busy: false, result: { ok: false, error: String((err && err.message) || t('fail')) } }))
      })
    }

    // ── csv ──
    function exportCsv() {
      navigator.clipboard.writeText(pointsToCsv(normalizePack().points)).then(() => {
        setCsvNote(t('csvDone'))
        setTimeout(() => setCsvNote(''), 1500)
      }).catch(() => { /* clipboard unavailable */ })
    }

    function importCsv() {
      const parsed = csvToPoints(csvText)
      if (!parsed.ok) {
        setError(parsed.error)
        return
      }
      setError('')
      setCsvOpen(false)
      setCsvText('')
      persist({ points: parsed.points, values: [] })
    }

    // ── derived ──
    const pack = normalizePack()
    const conn = pack.conn || {}
    const points = Array.isArray(pack.points) ? pack.points : []
    const valuesArr = Array.isArray(pack.values) ? pack.values : []
    const valueMap = {}
    for (const item of valuesArr) valueMap[item.key] = item
    const pythonReady = statusKind(health.python) === 'ready'
    const sim = conn.sim === true
    const canDevice = sim || pythonReady
    const connMissing = !sim && (conn.mode === 'tcp' ? !conn.host : !conn.port)
    const watchEnabled = !!(pack.polling && pack.polling.enabled)

    function toggleSim() {
      const next = !sim
      const patch = { sim: next }
      if (next && !points.length) {
        setError('')
      }
      setConn(patch)
      if (next && typeof openLive === 'function') openLive()
    }

    function toggleWatch() {
      persist({ polling: { enabled: !watchEnabled, intervalMs: (pack.polling && pack.polling.intervalMs) || 1000 } })
      if (!watchEnabled && typeof openLive === 'function') openLive()
    }

    // ── serial log / frames ──
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

    function copyLogText() {
      if (logMode === 'frames') {
        const rows = frameRowsFiltered
        const text = rows.map((item) => '[' + clockOf(item.t) + '] ' + item.tx + (item.rx ? '\n  ' + item.rx : '')).join('\n')
        if (!text) return
        navigator.clipboard.writeText(text).then(() => {
          setCopiedSerial(true)
          setTimeout(() => setCopiedSerial(false), 1500)
        }).catch(() => { /* clipboard unavailable */ })
        return
      }
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

    const serialFilterText = serial.filter.trim().toLowerCase()
    const serialLines = serialFilterText
      ? serial.lines.filter((item) => item.line.toLowerCase().includes(serialFilterText))
      : serial.lines
    const framesAll = getFramesLog(cwd)
    const frameRows = framesAll.map((item) => ({
      t: item.t,
      tx: '→ ' + (item.request || '(无帧)') + ' · ' + item.label + (item.deviceName ? ' · ' + item.deviceName : ''),
      rx: item.response ? '← ' + item.response : '',
    }))
    const frameRowsFiltered = serialFilterText
      ? frameRows.filter((item) => (item.tx + item.rx).toLowerCase().includes(serialFilterText))
      : frameRows

    function logBody() {
      if (logMode === 'frames') {
        if (!frameRowsFiltered.length) return el('div', { className: 'dvb-empty' }, t('framesEmpty'))
        return el('pre', {
          className: 'dvb-log dvb-serial-log',
          ref: (node) => {
            if (node && !serial.paused) node.scrollTop = node.scrollHeight
          },
        }, frameRowsFiltered.map((item, idx) => el('div', {
          key: item.t + ':' + idx,
          className: 'dvb-serial-line',
          title: framesAll[idx] && framesAll[idx].trace ? undefined : undefined,
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
      field(t('serialFilter'), el('input', {
        className: 'dvb-input',
        value: serial.filter,
        placeholder: 'error, assert…',
        spellCheck: false,
        autoComplete: 'off',
        onChange(event) { setSerial((prev) => ({ ...prev, filter: event.target.value })) },
      })),
      logBody())

    // ── connection bar ──
    const connBar = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('connBar')),
        el('span', { className: 'dvb-tag' }, connLabel(conn)),
        sim ? el('span', { className: 'dvb-tag' }, t('sim')) : null,
        el('button', {
          type: 'button',
          className: 'dvb-btn' + (sim ? ' is-on' : ''),
          disabled: !cwd,
          title: t('simHint'),
          onClick: toggleSim,
        }, t('sim')),
        el('button', {
          type: 'button', className: 'dvb-btn', disabled: !cwd,
          onClick() { setConn(emptyConnPatch()) },
        }, t('removeDevice')),
        !canDevice ? el('span', { className: 'dvb-need' }, t('needBindingsRead')) : null),
      el('div', { className: 'dvb-toolbar' },
        field(t('mode'), el('select', {
          className: 'dvb-input',
          value: conn.mode,
          onChange(event) { setConn({ mode: event.target.value }) },
        },
          el('option', { value: 'rtu' }, 'RTU'),
          el('option', { value: 'tcp' }, 'TCP'))),
        conn.mode === 'rtu'
          ? field(t('serial'), el('div', { className: 'dvb-combo' },
            el('select', {
              className: 'dvb-input dvb-input-mono',
              value: conn.port || '',
              disabled: scanning,
              onChange(event) { setConn({ port: event.target.value }) },
            },
              el('option', { value: '' }, scanning ? t('serialScanning') : (ports.length ? t('serialPick') : t('serialNone'))),
              conn.port && !ports.some((item) => item.path === conn.port)
                ? el('option', { value: conn.port }, conn.port + ' · ' + t('serialGone'))
                : null,
              ports.map((item) => el('option', { key: item.path, value: item.path }, item.label || item.path))),
            el('button', {
              type: 'button', className: 'dvb-btn',
              disabled: scanning,
              title: t('serialScan'),
              onClick: scanPorts,
            }, t('serialScan'))))
          : field(t('host'), el('input', {
            className: 'dvb-input dvb-input-mono',
            value: conn.host || '',
            spellCheck: false,
            autoComplete: 'off',
            onChange(event) { setConn({ host: event.target.value }) },
          })),
        field(t('baudrate'), el('input', {
          className: 'dvb-input dvb-input-mono', type: 'number', value: conn.baudrate || 9600,
          onChange(event) { setConn({ baudrate: Number(event.target.value) }) },
        })),
        field(t('slave'), el('input', {
          className: 'dvb-input dvb-input-mono', type: 'number', value: conn.slave, min: 0, max: 247,
          onChange(event) { setConn({ slave: Number(event.target.value) }) },
        })),
        field(t('databits'), el('select', {
          className: 'dvb-input',
          value: String(conn.bytesize || 8),
          onChange(event) { setConn({ bytesize: Number(event.target.value) }) },
        }, el('option', { value: '8' }, '8'), el('option', { value: '7' }, '7'))),
        field(t('parityBit'), el('select', {
          className: 'dvb-input',
          value: conn.parity || 'N',
          onChange(event) { setConn({ parity: event.target.value }) },
        }, el('option', { value: 'N' }, 'N'), el('option', { value: 'E' }, 'E'), el('option', { value: 'O' }, 'O'))),
        field(t('stopbit'), el('select', {
          className: 'dvb-input',
          value: String(conn.stopbits || 1),
          onChange(event) { setConn({ stopbits: Number(event.target.value) }) },
        }, el('option', { value: '1' }, '1'), el('option', { value: '2' }, '2')))))

    function emptyConnPatch() {
      return { host: '', tcpPort: 502, slave: 1, bytesize: 8, parity: 'N', stopbits: 1, baudrate: 9600 }
    }

    // ── point form ──
    const formPanel = form.mode !== 'hidden'
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-panel-head' },
          el('span', { className: 'dvb-panel-title' }, (form.mode === 'edit' ? t('editing') : t('addPoint'))
            + (form.mode === 'edit' ? ' · ' + form.id : '')),
          el('button', {
            type: 'button', className: 'dvb-btn', onClick: closeForm,
          }, t('csvCancel'))),
        el('div', { className: 'dvb-toolbar' },
          field(t('ptName'), el('input', {
            className: 'dvb-input',
            value: form.name,
            placeholder: t('ptNamePh'),
            onChange(event) { setForm((prev) => ({ ...prev, name: event.target.value })) },
          })),
          field(t('ptFc'), el('select', {
            className: 'dvb-input',
            value: String(form.function),
            onChange(event) { setForm((prev) => ({ ...prev, function: Number(event.target.value) })) },
          },
            el('option', { value: '1' }, fnOptionLabel(t, 1)),
            el('option', { value: '2' }, fnOptionLabel(t, 2)),
            el('option', { value: '3' }, fnOptionLabel(t, 3)),
            el('option', { value: '4' }, fnOptionLabel(t, 4)))),
          field(t('ptAddr'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number',
            value: form.address,
            min: 0, max: 65535,
            onChange(event) { setForm((prev) => ({ ...prev, address: Number(event.target.value) })) },
          })),
          field(t('ptScale'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.scale,
            onChange(event) { setForm((prev) => ({ ...prev, scale: Number(event.target.value) })) },
          })),
          field(t('ptOffset'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.offset,
            onChange(event) { setForm((prev) => ({ ...prev, offset: Number(event.target.value) })) },
          })),
          field(t('ptUnit'), el('input', {
            className: 'dvb-input',
            value: form.unit,
            onChange(event) { setForm((prev) => ({ ...prev, unit: event.target.value })) },
          })),
          field(t('ptAlarmMin'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.alarmMin,
            onChange(event) { setForm((prev) => ({ ...prev, alarmMin: event.target.value })) },
          })),
          field(t('ptAlarmMax'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number', step: 'any',
            value: form.alarmMax,
            onChange(event) { setForm((prev) => ({ ...prev, alarmMax: event.target.value })) },
          }))),
        el('div', { className: 'dvb-actions' },
          el('button', {
            type: 'button', className: 'dvb-btn dvb-btn-primary',
            disabled: !cwd,
            onClick: submitPoint,
          }, t('savePoint'))))
      : null

    const batchPanel = batch.open
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-hint' }, t('batchAdd')),
        el('div', { className: 'dvb-toolbar' },
          field(t('batchPrefix'), el('input', {
            className: 'dvb-input',
            value: batch.prefix,
            placeholder: 'HR',
            onChange(event) { setBatch((prev) => ({ ...prev, prefix: event.target.value })) },
          })),
          field(t('ptFc'), el('select', {
            className: 'dvb-input',
            value: String(batch.fc),
            onChange(event) { setBatch((prev) => ({ ...prev, fc: Number(event.target.value) })) },
          },
            el('option', { value: '1' }, fnOptionLabel(t, 1)),
            el('option', { value: '3' }, fnOptionLabel(t, 3)))),
          field(t('batchStart'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number',
            value: batch.start,
            min: 0, max: 65535,
            onChange(event) { setBatch((prev) => ({ ...prev, start: Number(event.target.value) })) },
          })),
          field(t('batchCount'), el('input', {
            className: 'dvb-input dvb-input-mono', type: 'number',
            value: batch.count, min: 1, max: 64,
            onChange(event) { setBatch((prev) => ({ ...prev, count: Number(event.target.value) })) },
          })),
          field('\u00a0', el('button', {
            type: 'button', className: 'dvb-btn dvb-btn-primary', onClick: generateBatch,
          }, t('batchGenerate')))))
      : null

    // ── points table ──
    const readRunning = runningOf(journal, 'read')
    const writeRunning = runningOf(journal, 'write')
    const tableRows = points.map((point) => {
      const rec = valueMap[point.id]
      const shown = rec && rec.ok && rec.raw !== null && rec.raw !== undefined
        ? decodeValue(point, typeof rec.raw === 'boolean' ? (rec.raw ? 1 : 0) : rec.raw)
        : (rec && rec.ok === false ? rec.error : '—')
      const writable = isWritableFunction(point.function)
      const isWriting = writeRow && writeRow.pointId === point.id
      return el('tr', { key: point.id, 'data-kind': 'pt' },
        el('td', null, point.name || functionTag(point.function) + point.address),
        el('td', null, functionTag(point.function)),
        el('td', { className: 'dvb-val' }, String(point.address)),
        el('td', { className: 'dvb-val' }, (point.scale === 1 ? '' : '×' + point.scale) + (point.offset ? (point.offset > 0 ? '+' : '') + point.offset : '') || '—'),
        el('td', null, point.unit || '—'),
        el('td', { className: 'dvb-val', 'data-ok': rec ? (rec.ok ? 'true' : 'false') : '' },
          rec && rec.at ? clockOf(rec.at) : '—'),
        writable
          ? el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-write',
            disabled: !cwd || !canDevice || connMissing || !!busy || writeRunning,
            onClick() { openWriteRow(point) },
          }, t('quickWrite'))
          : null,
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: !cwd || !!busy,
          onClick() { readOne(point.id) },
        }, busy === point.id ? t('reading') : t('readSegment')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          onClick() { openEditPoint(point) },
        }, t('editing').slice(0, 2)),
        el('button', {
          type: 'button', className: 'dvb-btn', disabled: !!busy,
          onClick() { removePointRow(point) },
        }, t('deleteSegment')))
    })

    const pointsPanel = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('segments')),
        el('button', {
          type: 'button', className: 'dvb-btn dvb-btn-primary',
          disabled: !cwd,
          onClick: openAddPoint,
        }, t('addPoint')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          onClick() { setBatch((prev) => ({ ...prev, open: !prev.open })) },
        }, t('batchAdd')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          onClick() { setCsvOpen((prev) => !prev) },
        }, t('csvImport')),
        el('button', {
          type: 'button', className: 'dvb-btn',
          disabled: !points.length,
          onClick: exportCsv,
        }, csvNote || t('csvExport')),
        el('button', {
          type: 'button',
          className: 'dvb-btn',
          disabled: !cwd || !canDevice || connMissing || !points.length || !!busy || readRunning,
          onClick() { readAll() },
        }, busy === 'read' || (readRunning && busy !== 'read')
          ? (readRunning && runningSource(journal, 'read') === 'agent' ? t('agentReading') : t('reading'))
          : t('readAll')),
        el('button', {
          type: 'button',
          className: 'dvb-btn dvb-btn-primary' + (watchEnabled ? ' is-on' : ''),
          disabled: !cwd || !canDevice || connMissing || !points.length,
          onClick: toggleWatch,
        }, watchEnabled ? t('liveStop') : t('liveStart')),
        watchEnabled
          ? el('select', {
            className: 'dvb-input dvb-live-interval',
            value: String((pack.polling && pack.polling.intervalMs) || 1000),
            onChange(event) { persist({ polling: { enabled: true, intervalMs: Number(event.target.value) } }) },
          }, POLL_INTERVALS.map((ms) => el('option', { key: String(ms), value: String(ms) }, (ms / 1000) + 's')))
          : null,
        !canDevice || connMissing
          ? el('span', { className: 'dvb-need' }, connMissing ? (conn.mode === 'tcp' ? t('needHost') : t('needSerial')) : t('needBindingsRead'))
          : null),
      batchPanel,
      csvOpen
        ? el('div', { className: 'dvb-write-panel' },
          el('div', { className: 'dvb-hint' }, t('csvReplaceHint')),
          el('textarea', {
            className: 'dvb-input dvb-csv-area',
            value: csvText,
            rows: 5,
            spellCheck: false,
            placeholder: 'name,function,address,scale,offset,unit,alarmMin,alarmMax',
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
      points.length
        ? el('div', { className: 'dvb-table-wrap' },
          el('table', { className: 'dvb-table' },
            el('thead', null, el('tr', null,
              el('th', null, t('colName')),
              el('th', null, t('colFn')),
              el('th', null, t('colAddr')),
              el('th', null, '×/+'),
              el('th', null, t('ptUnit')),
              el('th', null, t('time')),
              el('th', null, ''))),
            el('tbody', null, tableRows)))
        : el('div', { className: 'dvb-empty' }, t('noPoints')))

    // ── pending agent approvals ──
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

    function resolveWrite(id, approved) {
      post('/dsh-vision-bench/modbus/write/approve', { cwd, id, approved }, 120000).then((data) => {
        setPending((prev) => prev.filter((item) => item.id !== id))
        if (data && data.ok === false && !data.rejected) setError(data.error || t('fail'))
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
        }
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      })
    }

    // ── inline write strip under table ──
    const writeStrip = writeRow
      ? el('div', { className: 'dvb-write-inline' },
        el('div', { className: 'dvb-write-head' },
          el('span', { className: 'dvb-write-title' }, t('quickWrite') + ' · '
            + (writeRow.name || functionTag(writeRow.fn) + writeRow.address)
            + ' (' + functionTag(writeRow.fn) + '@' + writeRow.address + ')'),
          el('button', {
            type: 'button', className: 'dvb-btn',
            disabled: writeRow.busy,
            onClick() { setWriteRow(null) },
          }, t('writeClose'))),
        el('div', { className: 'dvb-write-form' },
          writeRow.fn === 1
            ? el('select', {
              className: 'dvb-input',
              value: String(Number(writeRow.text) ? 1 : 0),
              disabled: writeRow.busy,
              onChange(event) { setWriteRow((prev) => ({ ...prev, text: event.target.value })) },
            },
              el('option', { value: '0' }, t('coilOff')),
              el('option', { value: '1' }, t('coilOn')))
            : el('input', {
              className: 'dvb-input dvb-input-mono', type: 'number', min: 0, max: 65535,
              value: writeRow.text,
              disabled: writeRow.busy,
              spellCheck: false,
              onChange(event) { setWriteRow((prev) => ({ ...prev, text: event.target.value })) },
              onKeyDown(event) {
                if (event.key === 'Enter' && !writeRow.busy) submitWriteRow()
              },
            }),
          el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary dvb-btn-write',
            disabled: !cwd || writeRow.busy,
            onClick: submitWriteRow,
          }, writeRow.busy ? t('writing') : t('confirmWrite'))),
        writeRow.result
          ? (writeRow.result.ok === false
            ? el('div', { className: 'dvb-write-result', 'data-kind': 'err' },
              writeRow.result.summary || writeRow.result.error || t('fail'))
            : el('div', { className: 'dvb-write-result', 'data-kind': 'ok' },
              (writeRow.result.before && writeRow.result.before[0] !== null && writeRow.result.before[0] !== undefined ? String(writeRow.result.before[0]) : '—')
              + ' → ' + String(writeRow.result.target && writeRow.result.target[0])
              + ' → ' + (writeRow.result.readback && writeRow.result.readback[0] !== undefined ? String(writeRow.result.readback[0]) : '—')))
          : null)
      : null

    return el('div', { className: 'dvb-page' },
      statusBar(el, t, cwd, [{ key: 'python', health: health.python }]),
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      connBar,
      pointsPanel,
      formPanel,
      writeStrip,
      pendingPanel,
      serialPanel,
      journalPanel(el, t, journal))
  }
}
