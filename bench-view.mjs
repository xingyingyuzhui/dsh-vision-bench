import { NS } from './bench-i18n.mjs'
import { statusKind } from './bench-settings.mjs'

export function formatResult(result) {
  if (!result) return ''
  const details = result.details || {}
  const metrics = result.metrics || {}
  const lines = []
  if (result.summary) lines.push(result.summary)
  if (metrics.compile_errors != null || metrics.after_build_errors != null) {
    lines.push(
      '编译/链接 ' + String(metrics.compile_errors || 0)
      + ' · 后处理 ' + String(metrics.after_build_errors || 0)
      + ' · 警告 ' + String(metrics.warnings || 0),
    )
  } else if (metrics.errors != null) {
    lines.push('errors=' + metrics.errors + ' warnings=' + metrics.warnings)
  }
  if (details.phase && details.phase !== 'ok') {
    lines.push(details.phase === 'after_build' ? '阶段: 后处理' : '阶段: 编译/链接')
  }
  const errs = Array.isArray(details.errors) ? details.errors : []
  if (errs.length) {
    lines.push('错误:')
    for (const item of errs.slice(0, 8)) lines.push('  ' + item)
  }
  if (details.log_file) lines.push('日志: ' + details.log_file)
  if (result.download && result.download.path) {
    lines.push(result.download.wanted + ': ' + result.download.path)
  } else if (result.download && result.download.wanted) {
    lines.push('未生成 ' + result.download.wanted
      + (result.download.available && result.download.available.length
        ? '（已有 ' + result.download.available.join(', ') + '）'
        : ''))
  } else if (details.flash_file) {
    lines.push(details.flash_file)
  }
  if (details.value !== undefined) lines.push('value=' + JSON.stringify(details.value))
  return lines.filter(Boolean).join('\n') || JSON.stringify(result, null, 2)
}

function agentNote(cwd, workspace, result) {
  const keil = workspace && workspace.keil ? workspace.keil : {}
  const download = result && result.download ? result.download : {}
  const metrics = result && result.metrics ? result.metrics : {}
  return [
    '[调试台架]',
    '工作区: ' + (cwd || ''),
    '工程: ' + (keil.project || ''),
    'Target: ' + (keil.target || ''),
    '输出格式: ' + (keil.artifact || 'hex'),
    download.path ? '输出: ' + download.path : (result ? '输出: 未生成所选格式' : ''),
    result && result.summary ? '结果: ' + result.summary : '',
    metrics.compile_errors != null
      ? '编译/链接=' + metrics.compile_errors + ' 后处理=' + metrics.after_build_errors + ' warnings=' + metrics.warnings
      : (metrics.errors != null ? 'errors=' + metrics.errors + ' warnings=' + metrics.warnings : ''),
    result && result.details && result.details.log_file ? '日志: ' + result.details.log_file : '',
    result && result.details && Array.isArray(result.details.errors) && result.details.errors.length
      ? '错误: ' + result.details.errors.slice(0, 4).join(' | ')
      : '',
  ].filter(Boolean).join('\n')
}

function useSessionCwd(React, props) {
  const sessionId = props && props.sessionId
  return props && props.useSessions
    ? props.useSessions((s) => (s.byId && sessionId && s.byId[sessionId] && s.byId[sessionId].cwd) || '')
    : ''
}

function emptyWorkspace() {
  return {
    keil: { project: '', target: '', artifact: 'hex' },
    modbus: { mode: 'rtu', port: '', baudrate: 9600, host: '', tcpPort: 502, slave: 1, function: 3, address: 0, count: 1, segments: [], values: [] },
  }
}

const POLL_MS = 2000

function emptyJournal() {
  return { tasks: [], running: [], timeline: [] }
}

function pickJournal(data) {
  if (data && data.journal) return data.journal
  const workspace = data && data.workspace
  const tasks = workspace && Array.isArray(workspace.tasks) ? workspace.tasks : []
  const timeline = workspace && Array.isArray(workspace.timeline) ? workspace.timeline : []
  return {
    tasks,
    running: tasks.filter((item) => item && item.status === 'running'),
    timeline,
  }
}

function runningOf(journal, type) {
  const list = journal && Array.isArray(journal.running) ? journal.running : []
  return list.some((item) => item && item.type === type && item.status === 'running')
}

function runningSource(journal, type) {
  const list = journal && Array.isArray(journal.running) ? journal.running : []
  const hit = list.find((item) => item && item.type === type && item.status === 'running')
  return hit ? hit.source : ''
}

function formatClock(at) {
  const n = Number(at)
  if (!Number.isFinite(n) || n <= 0) return ''
  try {
    return new Date(n).toLocaleTimeString(undefined, { hour12: false })
  } catch {
    return ''
  }
}

function sourceLabel(t, source) {
  return source === 'agent' ? t('sourceAgent') : t('sourceUser')
}

function statusLabel(t, status) {
  if (status === 'running') return t('statusRunning')
  if (status === 'ok') return t('statusOk')
  if (status === 'cancelled') return t('statusCancelled')
  return t('statusError')
}

function typeLabel(t, type) {
  return type === 'read' ? t('taskRead') : t('taskBuild')
}

function journalPanel(el, t, journal) {
  const tasks = journal && Array.isArray(journal.tasks) ? journal.tasks : []
  const timeline = journal && Array.isArray(journal.timeline) ? journal.timeline : []
  if (!tasks.length && !timeline.length) return null
  return el('div', { className: 'dvb-journal' },
    tasks.length ? el('div', { className: 'dvb-journal-title' }, t('tasks')) : null,
    tasks.slice(0, 6).map((item) => el('div', {
      key: item.id,
      className: 'dvb-task',
      'data-status': item.status,
      'data-source': item.source,
    },
      el('span', { className: 'dvb-badge' }, formatClock(item.startedAt)),
      el('span', { className: 'dvb-badge', 'data-source': item.source }, sourceLabel(t, item.source)),
      el('span', null, typeLabel(t, item.type)),
      el('span', { className: 'dvb-badge' }, statusLabel(t, item.status)),
      el('span', {
        className: 'dvb-hint',
        title: [item.logFile, item.phase].concat(Array.isArray(item.errors) ? item.errors : []).filter(Boolean).join('\n'),
      }, item.summary || (item.errors && item.errors[0]) || ''))),
    timeline.length ? el('div', { className: 'dvb-journal-title' }, t('timeline')) : null,
    timeline.slice(0, 8).map((item) => el('div', {
      key: item.id,
      className: 'dvb-event',
      'data-source': item.source,
      'data-ok': item.ok === false ? 'false' : item.ok === true ? 'true' : '',
    },
      el('span', { className: 'dvb-badge' }, formatClock(item.at)),
      el('span', { className: 'dvb-badge', 'data-source': item.source }, sourceLabel(t, item.source)),
      el('span', { className: 'dvb-hint' }, item.summary || item.kind))))
}

function statusBar(el, t, cwd, rows) {
  return el('div', { className: 'dvb-bar' },
    el('div', { className: 'dvb-health' }, rows.map((row) => el('span', {
      key: row.key,
      className: 'dvb-chip',
      'data-kind': statusKind(row.health),
    }, t(row.key) + ' · ' + t(statusKind(row.health))))),
    cwd
      ? el('div', { className: 'dvb-cwd' }, t('workspace') + '  ' + cwd)
      : el('div', { className: 'dvb-msg', 'data-kind': 'err' }, t('needWorkspace')))
}

export function createDebugView(React, t, post, openProject) {
  return function DebugView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = (props && props.sessionId) || ''
    const [health, setHealth] = React.useState({})
    const [workspace, setWorkspace] = React.useState(emptyWorkspace)
    const [journal, setJournal] = React.useState(emptyJournal)
    const [targets, setTargets] = React.useState([])
    const [busy, setBusy] = React.useState('')
    const [error, setError] = React.useState('')
    const [buildOut, setBuildOut] = React.useState('')
    const [lastResult, setLastResult] = React.useState(null)
    const [copied, setCopied] = React.useState(false)
    const [picker, setPicker] = React.useState(null)
    const projectRef = React.useRef('')

    React.useEffect(() => {
      let stop = false
      function pull(first) {
        post('/dsh-vision-bench/state', { cwd: cwd || '' }).then((data) => {
          if (stop) return
          if (data && data.health) setHealth(data.health)
          if (data && data.workspace) {
            setWorkspace((prev) => ({
              ...prev,
              keil: { ...prev.keil, ...(data.workspace.keil || {}) },
              session: data.workspace.session || prev.session,
            }))
            const project = data.workspace.keil && data.workspace.keil.project
            if (project && project !== projectRef.current) {
              projectRef.current = project
              loadTargets(project)
            }
          }
          setJournal(pickJournal(data))
        }).catch((err) => {
          if (first && !stop) setError(String((err && err.message) || t('loadFail')))
        })
      }
      pull(true)
      const timer = setInterval(() => pull(false), POLL_MS)
      return () => { stop = true; clearInterval(timer) }
    }, [cwd])

    function setKeil(patch) {
      setWorkspace((prev) => ({ ...prev, keil: { ...prev.keil, ...patch } }))
    }

    const boundId = workspace.session && workspace.session.boundId ? workspace.session.boundId : ''
    const bindState = !sessionId
      ? 'none'
      : (boundId === sessionId ? 'self' : (boundId ? 'other' : 'open'))

    function bindToSelf() {
      if (!cwd || !sessionId) return
      post('/dsh-vision-bench/session/bind', { cwd, sessionId }, 15000).then(() => {
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (data && data.workspace) {
          setWorkspace((prev) => ({ ...prev, session: data.workspace.session || prev.session }))
        }
      }).catch(() => { /* chip refreshes on next poll */ })
    }

    function unbindBench() {
      if (!cwd) return
      post('/dsh-vision-bench/session/unbind', { cwd }, 15000).then(() => {
        setWorkspace((prev) => ({ ...prev, session: { boundId: '' } }))
      }).catch(() => { /* chip refreshes on next poll */ })
    }

    function persist(next) {
      if (!cwd) return Promise.resolve()
      const keil = (next && next.keil) || workspace.keil
      return post('/dsh-vision-bench/workspace', {
        cwd,
        keil: { project: keil.project || '', target: keil.target || '', artifact: keil.artifact || 'hex' },
      }).then((data) => {
        if (data && data.workspace) {
          setWorkspace((prev) => ({ ...prev, keil: data.workspace.keil, modbus: data.workspace.modbus || prev.modbus }))
        }
        if (data) setJournal(pickJournal(data))
      })
    }

    function run(name, path, payload, timeoutMs) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return Promise.resolve()
      }
      setBusy(name)
      setError('')
      return post(path, Object.assign({ cwd }, payload || {}), timeoutMs).then((data) => {
        if (data && data.ok === false) setError(data.error || t('fail'))
        return data
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
        return null
      }).finally(() => setBusy(''))
    }

    function openPicker(path) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return
      }
      setBusy('picker')
      setError('')
      post('/dsh-vision-bench/fs/list', { cwd, path: path || cwd }).then((data) => {
        setPicker(data)
      }).catch((err) => {
        setError(String((err && err.message) || t('fail')))
      }).finally(() => setBusy(''))
    }

    function chooseProject(path) {
      setPicker(null)
      setKeil({ project: path, target: '' })
      persist({ ...workspace, keil: { ...workspace.keil, project: path, target: '' } }).then(() => {
        loadTargets(path)
        if (typeof openProject === 'function') openProject()
      })
    }

    function loadTargets(project) {
      if (!project) return
      run('targets', '/dsh-vision-bench/keil/targets', { project }).then((data) => {
        if (!data) return
        const list = data.result && data.result.details && data.result.details.targets || []
        setTargets(list)
        if (list.length && !workspace.keil.target) {
          const name = list[0].name
          setKeil({ target: name })
          persist({ ...workspace, keil: { ...workspace.keil, project, target: name } })
        }
      })
    }

    function build() {
      persist().then(() => run('build', '/dsh-vision-bench/keil/build', {
        project: workspace.keil.project,
        target: workspace.keil.target,
        artifact: workspace.keil.artifact,
        source: 'user',
        sessionId,
      }, 620000)).then((data) => {
        if (!data) return
        setLastResult(data.result)
        setBuildOut(formatResult(data.result))
        setCopied(false)
        if (data.ok === false && typeof openProject === 'function') openProject()
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace && data.workspace.keil) {
          setWorkspace((prev) => ({ ...prev, keil: { ...prev.keil, ...data.workspace.keil } }))
        }
      })
    }

    function copyForAgent() {
      const text = agentNote(cwd, workspace, lastResult)
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))
      }
    }

    function field(label, control) {
      return el('div', { className: 'dvb-row' },
        el('div', { className: 'dvb-label' }, el('span', null, label)),
        control)
    }

    const pythonReady = statusKind(health.python) === 'ready'
    const uv4Ready = statusKind(health.uv4) === 'ready'
    const buildRunning = runningOf(journal, 'build')
    const buildBusy = !!busy || buildRunning
    const buildLabel = busy === 'build'
      ? t('building')
      : (buildRunning && runningSource(journal, 'build') === 'agent' ? t('agentBuilding') : (buildRunning ? t('building') : t('build')))
    const buildBlock = !cwd
      ? ''
      : (!pythonReady || !uv4Ready)
        ? t('needBindingsBuild')
        : (!workspace.keil.project ? t('needProject') : '')

    const pickerEl = picker ? el('div', { className: 'dvb-mask', onClick() { setPicker(null) } },
      el('div', { className: 'dvb-picker', onClick(event) { event.stopPropagation() } },
        el('div', { className: 'dvb-picker-head' },
          el('button', {
            type: 'button', className: 'dvb-btn', disabled: !picker.parent || !!busy,
            onClick() { openPicker(picker.parent) },
          }, t('pickerUp')),
          el('div', { className: 'dvb-hint' }, picker.path),
          el('button', { type: 'button', className: 'dvb-btn', onClick() { setPicker(null) } }, t('pickerClose'))),
        (picker.dirs || []).map((item) => el('button', {
          key: 'd-' + item.path, type: 'button', className: 'dvb-picker-row',
          onClick() { openPicker(item.path) },
        }, '▸ ' + item.name)),
        (picker.files || []).map((item) => el('button', {
          key: 'f-' + item.path, type: 'button', className: 'dvb-picker-row dvb-picker-file',
          onClick() { chooseProject(item.path) },
        }, item.name)),
        (!picker.dirs || !picker.dirs.length) && (!picker.files || !picker.files.length)
          ? el('div', { className: 'dvb-hint' }, t('pickerEmpty'))
          : null)) : null

    return el('div', { className: 'dvb-page' },
      statusBar(el, t, cwd, [
        { key: 'python', health: health.python },
        { key: 'uv4', health: health.uv4 },
      ]),
      sessionId
        ? el('div', { className: 'dvb-bindbar' },
          el('span', {
            className: 'dvb-chip',
            'data-kind': bindState === 'self' ? 'ready' : 'unbound',
          }, t('bindChip') + ' · ' + t('bindState_' + bindState)),
          bindState === 'self'
            ? el('button', {
              type: 'button', className: 'dvb-btn',
              disabled: !cwd,
              onClick: unbindBench,
            }, t('bindOff'))
            : el('button', {
              type: 'button',
              className: 'dvb-btn' + (bindState === 'open' ? ' dvb-btn-primary' : ''),
              disabled: !cwd,
              title: t('bindHint'),
              onClick: bindToSelf,
            }, t('bindOn')))
        : null,
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      el('div', { className: 'dvb-split' },
        el('div', { className: 'dvb-panel' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('project')),
            el('button', {
              type: 'button', className: 'dvb-btn', disabled: !cwd || !!busy,
              onClick() { openPicker(cwd) },
            }, busy === 'picker' ? t('opening') : t('browse')),
            el('button', {
              type: 'button', className: 'dvb-btn',
              disabled: !cwd || !workspace.keil.project,
              onClick() { if (typeof openProject === 'function') openProject() },
            }, t('mapOpen'))),
          el('div', { className: 'dvb-file' },
            el('div', { className: 'dvb-path', 'data-empty': workspace.keil.project ? '0' : '1' },
              workspace.keil.project || t('pickProject'))),
          el('div', { className: 'dvb-toolbar' },
            field(t('target'), el('select', {
              className: 'dvb-input',
              value: workspace.keil.target,
              disabled: !workspace.keil.project || busy === 'targets',
              onChange(event) {
                const target = event.target.value
                setKeil({ target })
                persist({ ...workspace, keil: { ...workspace.keil, target } })
              },
            }, [el('option', { key: '', value: '' }, t('pickTarget'))].concat(
              targets.map((item) => el('option', { key: item.name, value: item.name }, item.name))))),
            field(t('artifact'), el('select', {
              className: 'dvb-input',
              value: workspace.keil.artifact || 'hex',
              disabled: !workspace.keil.project,
              onChange(event) {
                const artifact = event.target.value
                setKeil({ artifact })
                persist({ ...workspace, keil: { ...workspace.keil, artifact } })
              },
            },
              el('option', { value: 'hex' }, '.hex'),
              el('option', { value: 'bin' }, '.bin'),
              el('option', { value: 'axf' }, '.axf'),
              el('option', { value: 'elf' }, '.elf'))),
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-primary',
              disabled: !cwd || !pythonReady || !uv4Ready || !workspace.keil.project || buildBusy,
              onClick: build,
            }, buildLabel),
            lastResult
              ? el('button', { type: 'button', className: 'dvb-btn', onClick: copyForAgent },
                copied ? t('copied') : t('copyAgent'))
              : null,
            !buildBusy && buildBlock ? el('span', { className: 'dvb-need' }, buildBlock) : null)),
        el('div', { className: 'dvb-panel dvb-panel-fill' },
          el('div', { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('outputLog'))),
          buildOut
            ? el('pre', { className: 'dvb-log' }, buildOut)
            : el('div', { className: 'dvb-empty' }, t('outputEmpty')))),
      journalPanel(el, t, journal),
      pickerEl)
  }
}

export function registerView(ctx, React, t, DebugPage, HmiPage) {
  const slots = ctx.get ? ctx.get('slots') : ctx.slots
  if (slots == null || React == null) return function () {}
  const stopDebug = slots.inject('conversation.view', function () {
    return slots.register({
      name: 'conversation.view',
      id: 'vision-bench-debug',
      order: 20,
      locale: NS,
      label() { return t('tabDebug') },
    }, DebugPage)
  })
  const stopHmi = slots.inject('conversation.view', function () {
    return slots.register({
      name: 'conversation.view',
      id: 'vision-bench-hmi',
      order: 21,
      locale: NS,
      label() { return t('tabHmi') },
    }, HmiPage)
  })
  return function () {
    if (typeof stopDebug === 'function') stopDebug()
    if (typeof stopHmi === 'function') stopHmi()
  }
}
