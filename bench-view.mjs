import { NS } from './bench-i18n.mjs'
import {
  emptyJournal,
  emptyWorkspace,
  formatClock,
  journalPanel,
  pickJournal,
  POLL_MS,
  runningOf,
  runningSource,
  sourceLabel,
  statusBar,
  statusLabel,
  subscribeState,
  typeLabel,
  useSessionCwd,
} from './bench-shared.mjs'
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


const FLASH_IFACES = ['cmsis-dap', 'stlink', 'jlink', 'ftdi', 'dap']
const FLASH_TARGETS = [
  'stm32f1x', 'stm32f2x', 'stm32f4x', 'stm32f7x', 'stm32g0x', 'stm32g4x',
  'stm32h7x', 'stm32l0x', 'stm32l4x', 'nrf51', 'nrf52', 'rp2040', 'lpc55',
  'kinetis', 'efm32', 'at91samd',
]


export function createDebugView(React, t, post, openProject) {
  return function DebugView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = (props && props.sessionId) || ''
    function field(label, control) {
      return el('div', { className: 'dvb-row' },
        el('div', { className: 'dvb-label' }, el('span', null, label)),
        control)
    }
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
    const [flash, setFlash] = React.useState({ interface: 'cmsis-dap', target: 'stm32f1x', busy: false, confirm: null, result: null })
    const workspaceRef = React.useRef(workspace)
    workspaceRef.current = workspace
    const projectRef = React.useRef('')

    React.useEffect(() => subscribeState(post, cwd, (data) => {
      if (!data) return
      if (data.health) setHealth(data.health)
      if (data.workspace) {
        setWorkspace((prev) => ({
          ...prev,
          keil: { ...prev.keil, ...(data.workspace.keil || {}) },
          session: data.workspace.session || prev.session,
          manualRequests: Array.isArray(data.workspace.manualRequests)
            ? data.workspace.manualRequests
            : prev.manualRequests,
        }))
        const project = data.workspace.keil && data.workspace.keil.project
        if (project && project !== projectRef.current) {
          projectRef.current = project
          loadTargets(project)
        }
      }
      setJournal(pickJournal(data))
    }), [cwd, post])

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

    function resolveManual(id, done) {
      if (!cwd) return
      post('/dsh-vision-bench/manual/resolve', { cwd, id, done }, 15000).then(() => {
        setWorkspace((prev) => ({
          ...prev,
          manualRequests: (prev.manualRequests || []).map((item) => item.id === id
            ? { ...item, status: done ? 'done' : 'rejected' }
            : item),
        }))
        return post('/dsh-vision-bench/state', { cwd })
      }).then((data) => {
        if (data && data.workspace) {
          setWorkspace((prev) => ({ ...prev, manualRequests: data.workspace.manualRequests || prev.manualRequests }))
        }
        if (data) setJournal(pickJournal(data))
      }).catch(() => { /* next poll refreshes */ })
    }

    const openManual = (workspace.manualRequests || []).filter((item) => item.status === 'pending')
    const manualPanel = openManual.length
      ? el('div', { className: 'dvb-panel dvb-write-panel' },
        el('div', { className: 'dvb-panel-head' },
          el('span', { className: 'dvb-panel-title' }, t('manualTitle'))),
        openManual.map((req) => el('div', { key: req.id, className: 'dvb-task' },
          el('span', { className: 'dvb-badge', 'data-source': req.sessionId ? 'agent' : 'user' }, req.sessionId ? 'Agent' : 'User'),
          el('span', { className: 'dvb-hint' }, req.text),
          el('button', {
            type: 'button',
            className: 'dvb-btn dvb-btn-primary',
            onClick() { resolveManual(req.id, true) },
          }, t('manualDone')),
          el('button', {
            type: 'button', className: 'dvb-btn',
            onClick() { resolveManual(req.id, false) },
          }, t('manualFail')))))
      : null

    function mergeState(data) {
      if (data && data.workspace) {
        setWorkspace((prev) => ({
          ...prev,
          keil: { ...prev.keil, ...(data.workspace.keil || {}) },
          session: data.workspace.session || prev.session,
        }))
      }
      if (data) setJournal(pickJournal(data))
      return data
    }

    function startFlash() {
      if (!cwd) return
      setFlash((prev) => ({ ...prev, busy: true, result: null }))
      post('/dsh-vision-bench/keil/download', {
        cwd,
        source: 'user',
        sessionId,
        interface: flash.interface,
        target: flash.target,
      }, 20000).then((data) => {
        if (data && data.needsConfirm) {
          setFlash((prev) => ({ ...prev, busy: false, confirm: data.request }))
          return null
        }
        setFlash((prev) => ({ ...prev, busy: false, confirm: null, result: data }))
        return post('/dsh-vision-bench/state', { cwd })
      }).then(mergeState).catch((err) => {
        setFlash((prev) => ({ ...prev, busy: false, result: { ok: false, error: String((err && err.message) || t('fail')) } }))
      })
    }

    function approveFlash() {
      const req = flash.confirm
      if (!req || !cwd) return
      setFlash((prev) => ({ ...prev, busy: true }))
      post('/dsh-vision-bench/keil/download', {
        cwd,
        source: 'user',
        sessionId,
        interface: req.interface,
        target: req.target,
        path: req.file,
        sha256: req.sha256 || '',
        size: req.size || 0,
        confirm: true,
      }, 180000).then((data) => {
        setFlash((prev) => ({ ...prev, busy: false, confirm: null, result: data }))
        return post('/dsh-vision-bench/state', { cwd })
      }).then(mergeState).catch((err) => {
        setFlash((prev) => ({ ...prev, busy: false, confirm: null, result: { ok: false, error: String((err && err.message) || t('fail')) } }))
      })
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
        // Judge from the latest server state, not the first-render closure:
        // auto-pick only when the workspace genuinely has no saved target.
        const saved = (workspaceRef.current.keil && workspaceRef.current.keil.target) || ''
        if (list.length && !saved) {
          const name = list[0].name
          setKeil({ target: name })
          persist({ ...workspaceRef.current, keil: { ...workspaceRef.current.keil, project, target: name } })
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
        // Do not merge keil back from the post-build snapshot: the user may
        // have changed target/artifact during a long build. The poll loop
        // keeps everything else fresh.
        if (!data) return
        setJournal(pickJournal(data))
      })
    }

    function copyForAgent() {
      const text = agentNote(cwd, workspace, lastResult)
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard.writeText(text).then(() => setCopied(true)).catch(() => setCopied(false))
      }
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

    const openocdReady = statusKind(health.openocd) === 'ready'
    const artifactPath = workspace.keil.download || ''
    const flashReq = flash.confirm
    const flashPanel = el('div', { className: 'dvb-panel' },
      el('div', { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('flashTitle')),
        !openocdReady ? el('span', { className: 'dvb-need' }, t('needOpenocd')) : null),
      el('div', { className: 'dvb-toolbar' },
        field(t('flashIface'), el('select', {
          className: 'dvb-input',
          value: flash.interface,
          disabled: flash.busy,
          onChange(event) { setFlash((prev) => ({ ...prev, interface: event.target.value })) },
        }, FLASH_IFACES.map((name) => el('option', { key: name, value: name }, name)))),
        field(t('flashTarget'), el('select', {
          className: 'dvb-input',
          value: flash.target,
          disabled: flash.busy,
          onChange(event) { setFlash((prev) => ({ ...prev, target: event.target.value })) },
        }, FLASH_TARGETS.map((name) => el('option', { key: name, value: name }, name))))),
      el('div', { className: 'dvb-file' },
        el('div', { className: 'dvb-path', 'data-empty': artifactPath ? '0' : '1' },
          artifactPath || t('flashNeedArtifact'))),
      flashReq
        ? el('div', { className: 'dvb-write-panel dvb-flash-confirm' },
          el('div', { className: 'dvb-write-title' }, t('flashConfirmTitle')),
          el('div', { className: 'dvb-hint' }, t('flashConfirmHint')),
          el('div', { className: 'dvb-cwd' }, flashReq.target + ' · ' + flashReq.interface + '\n' + flashReq.file),
          el('div', { className: 'dvb-hint' },
            Math.max(1, Math.round(flashReq.size / 1024)) + ' KB'
            + (flashReq.sha256 ? ' · sha256 ' + flashReq.sha256.slice(0, 16) + '…' : '')),
          el('div', { className: 'dvb-actions' },
            el('button', {
              type: 'button',
              className: 'dvb-btn dvb-btn-primary dvb-btn-write',
              disabled: flash.busy,
              onClick: approveFlash,
            }, flash.busy ? t('flashing') : t('flashApprove')),
            el('button', {
              type: 'button', className: 'dvb-btn',
              disabled: flash.busy,
              onClick() { setFlash((prev) => ({ ...prev, confirm: null })) },
            }, t('flashCancel'))))
        : el('button', {
          type: 'button',
          className: 'dvb-btn dvb-btn-write',
          disabled: !cwd || !openocdReady || !artifactPath || flash.busy,
          onClick: startFlash,
        }, flash.busy ? t('flashing') : t('flashBtn')),
      flash.result
        ? el('div', {
          className: 'dvb-msg',
          'data-kind': flash.result.ok ? 'ok' : 'err',
        }, flash.result.summary || flash.result.error || (flash.result.ok ? t('flashDone') : t('flashFail')))
        : null)


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
      flashPanel,
      manualPanel,
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
