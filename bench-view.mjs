import { NS } from './bench-i18n.mjs'
import { statusKind } from './bench-settings.mjs'
import {
  DEFAULT_OPENOCD_INTERFACE,
  DEFAULT_OPENOCD_TARGET,
  FLASH_INTERFACES,
  FLASH_TARGETS,
} from './src/domain/flash/openocd-profile.mjs'
import {
  POLL_MS,
  emptyJournal,
  emptyWorkspace,
  formatClock,
  pickJournal,
  runningOf,
  runningSource,
  sourceLabel,
  statusLabel,
  subscribeState,
  typeLabel,
  useSessionCwd,
} from './bench-shared.mjs'
import { getCustomSelect } from './src/ui/components/custom-select.mjs'

export function formatResult(result) {
  if (!result) return ''
  const details = result.details || {}
  const metrics = result.metrics || {}
  const lines = []
  if (result.summary) lines.push(result.summary)
  if (metrics.compile_errors != null || metrics.after_build_errors != null) {
    lines.push(
      '编译/链接 ' +
        String(metrics.compile_errors || 0) +
        ' · 后处理 ' +
        String(metrics.after_build_errors || 0) +
        ' · 警告 ' +
        String(metrics.warnings || 0),
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
    lines.push(
      '未生成 ' +
        result.download.wanted +
        (result.download.available && result.download.available.length
          ? '（已有 ' + result.download.available.join(', ') + '）'
          : ''),
    )
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
    '[Vision]',
    '工作区: ' + (cwd || ''),
    '工程: ' + (keil.project || ''),
    'Target: ' + (keil.target || ''),
    '输出格式: ' + (keil.artifact || 'hex'),
    download.path ? '输出: ' + download.path : result ? '输出: 未生成所选格式' : '',
    result && result.summary ? '结果: ' + result.summary : '',
    metrics.compile_errors != null
      ? '编译/链接=' +
        metrics.compile_errors +
        ' 后处理=' +
        metrics.after_build_errors +
        ' warnings=' +
        metrics.warnings
      : metrics.errors != null
        ? 'errors=' + metrics.errors + ' warnings=' + metrics.warnings
        : '',
    result && result.details && result.details.log_file ? '日志: ' + result.details.log_file : '',
    result && result.details && Array.isArray(result.details.errors) && result.details.errors.length
      ? '错误: ' + result.details.errors.slice(0, 4).join(' | ')
      : '',
  ]
    .filter(Boolean)
    .join('\n')
}

export function createDebugView(React, t, post, openProject) {
  const CustomSelect = getCustomSelect(React)
  return function DebugView(props) {
    const el = React.createElement
    const cwd = useSessionCwd(React, props)
    const sessionId = (props && props.sessionId) || ''
    function field(label, control) {
      return el(
        'div',
        { className: 'dvb-row' },
        el('div', { className: 'dvb-label' }, el('span', null, label)),
        control,
      )
    }
    const [health, setHealth] = React.useState({})
    const [workspace, setWorkspace] = React.useState(emptyWorkspace)
    const [journal, setJournal] = React.useState(emptyJournal)
    const [targets, setTargets] = React.useState([])
    const [busy, setBusy] = React.useState('')
    const [error, setError] = React.useState('')
    const [buildOut, setBuildOut] = React.useState('')
    const [logView, setLogView] = React.useState({ open: false, text: '', filter: 'all', search: '', busy: false })
    const [lastResult, setLastResult] = React.useState(null)
    const [copied, setCopied] = React.useState(false)
    const [picker, setPicker] = React.useState(null)
    const [flash, setFlash] = React.useState({
      interface: DEFAULT_OPENOCD_INTERFACE,
      target: DEFAULT_OPENOCD_TARGET,
      busy: false,
      cancelBusy: false,
      confirm: null,
      result: null,
    })
    const [openocdFlash, setOpenocdFlash] = React.useState({
      status: 'checking',
      reason: '',
      versionLine: '',
      path: '',
    })
    const probedPathRef = React.useRef('')
    const boundPathRef = React.useRef('')
    const probeSeqRef = React.useRef(0)
    const unmountedRef = React.useRef(false)
    const flashRef = React.useRef(flash)
    flashRef.current = flash
    const cancelSentRef = React.useRef(false)
    const [pendingWrites, setPendingWrites] = React.useState([])
    const workspaceRef = React.useRef(workspace)
    workspaceRef.current = workspace
    const projectRef = React.useRef('')

    function probeOpenOcd(opts) {
      const force = !!(opts && opts.force)
      const boundPath = String((opts && opts.path != null ? opts.path : boundPathRef.current) || '')
      const bound = opts && Object.prototype.hasOwnProperty.call(opts, 'bound') ? !!opts.bound : !!boundPath
      const exists = opts && Object.prototype.hasOwnProperty.call(opts, 'exists') ? !!opts.exists : true
      if (unmountedRef.current) return
      if (!bound) {
        probeSeqRef.current += 1
        probedPathRef.current = ''
        boundPathRef.current = ''
        setOpenocdFlash({ status: 'missing', reason: '未绑定 OpenOCD', versionLine: '', path: '' })
        return
      }
      boundPathRef.current = boundPath
      if (!force && !exists) {
        if (probedPathRef.current === boundPath) return
        probeSeqRef.current += 1
        probedPathRef.current = boundPath
        setOpenocdFlash({ status: 'missing', reason: 'OpenOCD 路径不存在', versionLine: '', path: boundPath })
        return
      }
      if (!boundPath) return
      if (!force && boundPath === probedPathRef.current) return
      const seq = ++probeSeqRef.current
      probedPathRef.current = boundPath
      setOpenocdFlash({ status: 'checking', reason: '', versionLine: '', path: boundPath })
      post('/dsh-vision-bench/openocd/probe', { cwd }, 12000)
        .then((probe) => {
          if (unmountedRef.current || seq !== probeSeqRef.current) return
          if (probe && probe.ready === true) {
            setOpenocdFlash({
              status: 'ready',
              reason: probe.reason || '',
              versionLine: probe.versionLine || '',
              path: boundPath,
            })
            return
          }
          const invalid = probe && probe.errorCode === 'OPENOCD_IDENTITY_INVALID'
          setOpenocdFlash({
            status: invalid ? 'invalid' : 'failed',
            reason: (probe && (probe.reason || probe.error)) || 'OpenOCD 探测失败',
            versionLine: (probe && probe.versionLine) || '',
            path: boundPath,
          })
        })
        .catch((err) => {
          if (unmountedRef.current || seq !== probeSeqRef.current) return
          setOpenocdFlash({
            status: 'failed',
            reason: String((err && err.message) || 'OpenOCD 探测失败'),
            versionLine: '',
            path: boundPath,
          })
        })
    }
    const probeOpenOcdRef = React.useRef(probeOpenOcd)
    probeOpenOcdRef.current = probeOpenOcd

    React.useEffect(() => {
      unmountedRef.current = false
      cancelSentRef.current = false
      const stop = subscribeState(
        post,
        cwd,
        (data) => {
          if (!data) return
          if (data.health) setHealth(data.health)
          const boundPath = data.bindings && data.bindings.openocd ? String(data.bindings.openocd) : ''
          const bound = !!(data.health && data.health.openocd && data.health.openocd.bound)
          const exists = !!(data.health && data.health.openocd && data.health.openocd.exists)
          probeOpenOcdRef.current({ path: boundPath, bound, exists, force: false })
          if (Array.isArray(data.pendingWrites)) setPendingWrites(data.pendingWrites)
          if (data.workspace) {
            setWorkspace((prev) => ({
              ...prev,
              keil: { ...prev.keil, ...(data.workspace.keil || {}) },
              session: data.workspace.session || prev.session,
              manualRequests: Array.isArray(data.workspace.manualRequests)
                ? data.workspace.manualRequests
                : prev.manualRequests,
              modbus: data.workspace.modbus || prev.modbus,
            }))
          }
          setJournal(pickJournal(data))
        },
        { sessionId },
      )
      return () => {
        unmountedRef.current = true
        const cur = flashRef.current
        const id = cur && cur.confirm && cur.confirm.requestId
        if (id && !cur.busy && !cancelSentRef.current) {
          cancelSentRef.current = true
          post(
            '/dsh-vision-bench/keil/download',
            { cwd, requestId: id, approved: false, source: 'user', sessionId },
            15000,
          ).catch(() => {})
        }
        if (typeof stop === 'function') stop()
      }
    }, [cwd, post, sessionId])

    function setKeil(patch) {
      setWorkspace((prev) => ({ ...prev, keil: { ...prev.keil, ...patch } }))
    }

    // Task7/0.19.2: Vision 自动服务当前 Session — 绑定 UI 已移除，boundId 只读兼容。
    function resolveManual(id, done) {
      if (!cwd) return
      post('/dsh-vision-bench/manual/resolve', { cwd, id, done }, 15000)
        .then(() => {
          setWorkspace((prev) => ({
            ...prev,
            manualRequests: (prev.manualRequests || []).map((item) =>
              item.id === id ? { ...item, status: done ? 'done' : 'rejected' } : item,
            ),
          }))
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          if (data && data.workspace) {
            setWorkspace((prev) => ({ ...prev, manualRequests: data.workspace.manualRequests || prev.manualRequests }))
          }
          if (data) setJournal(pickJournal(data))
        })
        .catch(() => {
          /* next poll refreshes */
        })
    }

    const openManual = (workspace.manualRequests || []).filter((item) => item.status === 'pending')
    const manualPanel = openManual.length
      ? el(
          'div',
          { className: 'dvb-panel dvb-write-panel' },
          el('div', { className: 'dvb-panel-head' }, el('span', { className: 'dvb-panel-title' }, t('manualTitle'))),
          openManual.map((req) =>
            el(
              'div',
              { key: req.id, className: 'dvb-task' },
              el(
                'span',
                { className: 'dvb-badge', 'data-source': req.sessionId ? 'agent' : 'user' },
                req.sessionId ? 'Agent' : 'User',
              ),
              el('span', { className: 'dvb-hint' }, req.text),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-primary',
                  onClick() {
                    resolveManual(req.id, true)
                  },
                },
                t('manualDone'),
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  onClick() {
                    resolveManual(req.id, false)
                  },
                },
                t('manualFail'),
              ),
            ),
          ),
        )
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
      if (!cwd || openocdFlash.status !== 'ready') return
      cancelSentRef.current = false
      setFlash((prev) => ({ ...prev, busy: true, result: null, cancelBusy: false }))
      post(
        '/dsh-vision-bench/keil/download',
        {
          cwd,
          source: 'user',
          sessionId,
          interface: flash.interface,
          target: flash.target,
        },
        20000,
      )
        .then((data) => {
          if (data && data.needsConfirm) {
            setFlash((prev) => ({ ...prev, busy: false, confirm: data.request }))
            return null
          }
          setFlash((prev) => ({ ...prev, busy: false, confirm: null, result: data }))
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then(mergeState)
        .catch((err) => {
          setFlash((prev) => ({
            ...prev,
            busy: false,
            result: { ok: false, error: String((err && err.message) || t('fail')) },
          }))
        })
    }

    function approveFlash() {
      const req = flash.confirm
      if (!req || !cwd) return
      cancelSentRef.current = true
      setFlash((prev) => ({ ...prev, busy: true, cancelBusy: false }))
      post(
        '/dsh-vision-bench/keil/download',
        {
          cwd,
          source: 'user',
          sessionId,
          requestId: req.requestId,
          approved: true,
        },
        180000,
      )
        .then((data) => {
          setFlash((prev) => ({ ...prev, busy: false, confirm: null, result: data }))
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then(mergeState)
        .catch((err) => {
          setFlash((prev) => ({
            ...prev,
            busy: false,
            confirm: null,
            result: { ok: false, error: String((err && err.message) || t('fail')) },
          }))
        })
    }

    function cancelFlash() {
      const req = flash.confirm
      if (!req || !cwd || flash.busy || flash.cancelBusy) return
      setFlash((prev) => ({ ...prev, cancelBusy: true, result: null }))
      post(
        '/dsh-vision-bench/keil/download',
        { cwd, requestId: req.requestId, approved: false, source: 'user', sessionId },
        15000,
      )
        .then((data) => {
          if (unmountedRef.current) return
          if (data && data.cancelled) {
            cancelSentRef.current = true
            setFlash((prev) => ({ ...prev, confirm: null, cancelBusy: false, busy: false, result: null }))
            return
          }
          setFlash((prev) => ({
            ...prev,
            cancelBusy: false,
            result: { ok: false, error: (data && data.error) || t('flashCancelFail') },
          }))
        })
        .catch((err) => {
          if (unmountedRef.current) return
          setFlash((prev) => ({
            ...prev,
            cancelBusy: false,
            result: { ok: false, error: String((err && err.message) || t('flashCancelFail')) },
          }))
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
      return post(path, Object.assign({ cwd }, payload || {}), timeoutMs)
        .then((data) => {
          if (data && data.ok === false) setError(data.error || t('fail'))
          return data
        })
        .catch((err) => {
          setError(String((err && err.message) || t('fail')))
          return null
        })
        .finally(() => setBusy(''))
    }

    function openPicker(path) {
      if (!cwd) {
        setError(t('needWorkspace'))
        return
      }
      setBusy('picker')
      setError('')
      post('/dsh-vision-bench/fs/list', { cwd, path: path || cwd })
        .then((data) => {
          setPicker(data)
        })
        .catch((err) => {
          setError(String((err && err.message) || t('fail')))
        })
        .finally(() => setBusy(''))
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
        const list = (data.result && data.result.details && data.result.details.targets) || []
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
      persist()
        .then(() =>
          run(
            'build',
            '/dsh-vision-bench/keil/build',
            {
              project: workspace.keil.project,
              target: workspace.keil.target,
              artifact: workspace.keil.artifact,
              source: 'user',
              sessionId,
            },
            620000,
          ),
        )
        .then((data) => {
          if (!data) return
          setLastResult(data.result)
          setBuildOut(formatResult(data.result))
          setCopied(false)
          if (data.ok === false && typeof openProject === 'function') openProject()
          return post('/dsh-vision-bench/state', { cwd })
        })
        .then((data) => {
          // Do not merge keil back from the post-build snapshot: the user may
          // have changed target/artifact during a long build. The poll loop
          // keeps everything else fresh.
          if (!data) return
          setJournal(pickJournal(data))
        })
    }

    // Task5/0.19.3: 编译错误 → 文件/行定位（打开工程结构并高亮）
    const buildErrors = (() => {
      const text = String(buildOut || '')
      const out = []
      const re = /^\s*(.+?)\((\d+)\)\s*:\s*(error|fatal error|warning)\s*:\s*(.*)$/gm
      let m = null
      while ((m = re.exec(text))) {
        out.push({
          file: m[1].trim(),
          line: Math.max(1, Number(m[2]) || 1),
          kind: m[3],
          text: m[4].trim().slice(0, 200),
        })
      }
      return out.slice(0, 60)
    })()
    function jumpToError(err) {
      if (!cwd || !err) return
      if (typeof openProject === 'function') openProject({ file: err.file, line: err.line })
    }
    function openFullLog() {
      if (!lastResult || !cwd) return
      setLogView((prev) => ({ ...prev, open: true, busy: true, text: '' }))
      const logFile =
        (lastResult && lastResult.details && (lastResult.details.log_file || lastResult.details.logFile)) || ''
      post('/dsh-vision-bench/keil/log', { cwd, logFile })
        .then((data) => {
          setLogView((prev) => ({
            ...prev,
            busy: false,
            text: (data && data.text) || '',
            error: data && data.ok === false ? data.error : '',
          }))
        })
        .catch((err) =>
          setLogView((prev) => ({ ...prev, busy: false, text: '', error: String((err && err.message) || '读取失败') })),
        )
    }

    function copyForAgent() {
      const text = agentNote(cwd, workspace, lastResult)
      if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
        navigator.clipboard
          .writeText(text)
          .then(() => setCopied(true))
          .catch(() => setCopied(false))
      }
    }

    const pythonReady = statusKind(health.python) === 'ready'
    const uv4Ready = statusKind(health.uv4) === 'ready'
    const buildRunning = runningOf(journal, 'build')
    const buildBusy = !!busy || buildRunning
    const buildLabel =
      busy === 'build'
        ? t('building')
        : buildRunning && runningSource(journal, 'build') === 'agent'
          ? t('agentBuilding')
          : buildRunning
            ? t('building')
            : t('build')
    const buildBlock = !cwd
      ? ''
      : !pythonReady || !uv4Ready
        ? t('needBindingsBuild')
        : !workspace.keil.project
          ? t('needProject')
          : ''

    const pickerEl = picker
      ? el(
          'div',
          {
            className: 'dvb-mask',
            onClick() {
              setPicker(null)
            },
          },
          el(
            'div',
            {
              className: 'dvb-picker',
              onClick(event) {
                event.stopPropagation()
              },
            },
            el(
              'div',
              { className: 'dvb-picker-head' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  disabled: !picker.parent || !!busy,
                  onClick() {
                    openPicker(picker.parent)
                  },
                },
                t('pickerUp'),
              ),
              el('div', { className: 'dvb-hint' }, picker.path),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  onClick() {
                    setPicker(null)
                  },
                },
                t('pickerClose'),
              ),
            ),
            (picker.dirs || []).map((item) =>
              el(
                'button',
                {
                  key: 'd-' + item.path,
                  type: 'button',
                  className: 'dvb-picker-row',
                  onClick() {
                    openPicker(item.path)
                  },
                },
                '▸ ' + item.name,
              ),
            ),
            (picker.files || []).map((item) =>
              el(
                'button',
                {
                  key: 'f-' + item.path,
                  type: 'button',
                  className: 'dvb-picker-row dvb-picker-file',
                  onClick() {
                    chooseProject(item.path)
                  },
                },
                item.name,
              ),
            ),
            (!picker.dirs || !picker.dirs.length) && (!picker.files || !picker.files.length)
              ? el('div', { className: 'dvb-hint' }, t('pickerEmpty'))
              : null,
          ),
        )
      : null

    const openocdReady = openocdFlash.status === 'ready'
    const artifactPath = workspace.keil.download || ''
    const flashReq = flash.confirm
    const showReprobe =
      !!openocdFlash.path &&
      (openocdFlash.status === 'failed' || openocdFlash.status === 'invalid' || openocdFlash.status === 'missing')
    const reprobeDisabled = openocdFlash.status === 'checking' || flash.busy
    const flashPanel = el(
      'div',
      { className: 'dvb-panel' },
      el(
        'div',
        { className: 'dvb-panel-head' },
        el('span', { className: 'dvb-panel-title' }, t('flashTitle')),
        !openocdReady
          ? el(
              'span',
              { className: 'dvb-need' },
              openocdFlash.status === 'checking' ? t('openocdChecking') : openocdFlash.reason || t('needOpenocd'),
            )
          : null,
        showReprobe
          ? el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                disabled: reprobeDisabled,
                onClick() {
                  probeOpenOcd({ force: true })
                },
              },
              t('openocdReprobe'),
            )
          : null,
      ),
      el(
        'div',
        { className: 'dvb-toolbar' },
        field(
          t('flashIface'),
          el(CustomSelect, {
            value: flash.interface,
            disabled: flash.busy,
            options: FLASH_INTERFACES.map((name) => ({ value: name, label: name })),
            onChange(val) {
              const value = val?.target ? val.target.value : val
              setFlash((prev) => ({ ...prev, interface: value }))
            },
          }),
        ),
        field(
          t('flashTarget'),
          el(CustomSelect, {
            value: flash.target,
            disabled: flash.busy,
            options: FLASH_TARGETS.map((name) => ({ value: name, label: name })),
            onChange(val) {
              const value = val?.target ? val.target.value : val
              setFlash((prev) => ({ ...prev, target: value }))
            },
          }),
        ),
      ),
      el(
        'div',
        { className: 'dvb-file' },
        el(
          'div',
          { className: 'dvb-path', 'data-empty': artifactPath ? '0' : '1' },
          artifactPath || t('flashNeedArtifact'),
        ),
      ),
      flashReq
        ? el(
            'div',
            { className: 'dvb-write-panel dvb-flash-confirm' },
            el('div', { className: 'dvb-write-title' }, t('flashConfirmTitle')),
            el('div', { className: 'dvb-hint' }, t('flashConfirmHint')),
            el('div', { className: 'dvb-cwd' }, flashReq.target + ' · ' + flashReq.interface + '\n' + flashReq.file),
            el(
              'div',
              { className: 'dvb-hint' },
              Math.max(1, Math.round(flashReq.size / 1024)) +
                ' KB' +
                (flashReq.sha256 ? ' · sha256 ' + flashReq.sha256.slice(0, 16) + '…' : ''),
            ),
            el(
              'div',
              { className: 'dvb-actions' },
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn dvb-btn-primary dvb-btn-write',
                  disabled: flash.busy,
                  onClick: approveFlash,
                },
                flash.busy ? t('flashing') : t('flashApprove'),
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  disabled: flash.busy || flash.cancelBusy,
                  onClick: cancelFlash,
                },
                t('flashCancel'),
              ),
            ),
          )
        : el(
            'button',
            {
              type: 'button',
              className: 'dvb-btn dvb-btn-write',
              disabled: !cwd || openocdFlash.status !== 'ready' || !artifactPath || flash.busy,
              onClick: startFlash,
            },
            flash.busy ? t('flashing') : t('flashBtn'),
          ),
      flash.result
        ? el(
            'div',
            {
              className: 'dvb-msg',
              'data-kind': flash.result.ok ? 'ok' : 'err',
            },
            flash.result.summary || flash.result.error || (flash.result.ok ? t('flashDone') : t('flashFail')),
          )
        : null,
    )

    return el(
      'div',
      { className: 'dvb-page' },
      error ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, error) : null,
      el(
        'div',
        { className: 'dvb-split' },
        el(
          'div',
          { className: 'dvb-panel' },
          el(
            'div',
            { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('project')),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                disabled: !cwd || !!busy,
                onClick() {
                  openPicker(cwd)
                },
              },
              busy === 'picker' ? t('opening') : t('browse'),
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn',
                disabled: !cwd || !workspace.keil.project,
                onClick() {
                  if (typeof openProject === 'function') openProject()
                },
              },
              t('mapOpen'),
            ),
          ),
          el(
            'div',
            { className: 'dvb-file' },
            el(
              'div',
              { className: 'dvb-path', 'data-empty': workspace.keil.project ? '0' : '1' },
              workspace.keil.project || t('pickProject'),
            ),
          ),
          el(
            'div',
            { className: 'dvb-toolbar' },
            field(
              t('target'),
              el(CustomSelect, {
                value: workspace.keil.target,
                disabled: !workspace.keil.project || busy === 'targets',
                options: [{ value: '', label: t('pickTarget') }].concat(
                  targets.map((item) => ({ value: item.name, label: item.name })),
                ),
                onChange(val) {
                  const target = val?.target ? val.target.value : val
                  setKeil({ target })
                  persist({ ...workspace, keil: { ...workspace.keil, target } })
                },
              }),
            ),
            field(
              t('artifact'),
              el(CustomSelect, {
                value: workspace.keil.artifact || 'hex',
                disabled: !workspace.keil.project,
                options: [
                  { value: 'hex', label: '.hex' },
                  { value: 'bin', label: '.bin' },
                  { value: 'axf', label: '.axf' },
                  { value: 'elf', label: '.elf' },
                ],
                onChange(val) {
                  const artifact = val?.target ? val.target.value : val
                  setKeil({ artifact })
                  persist({ ...workspace, keil: { ...workspace.keil, artifact } })
                },
              }),
            ),
            el(
              'button',
              {
                type: 'button',
                className: 'dvb-btn dvb-btn-primary',
                disabled: !cwd || !pythonReady || !uv4Ready || !workspace.keil.project || buildBusy,
                onClick: build,
              },
              buildLabel,
            ),
            lastResult
              ? el(
                  'button',
                  { type: 'button', className: 'dvb-btn', onClick: copyForAgent },
                  copied ? t('copied') : t('copyAgent'),
                )
              : null,
            !buildBusy && buildBlock ? el('span', { className: 'dvb-need' }, buildBlock) : null,
          ),
        ),
        el(
          'div',
          { className: 'dvb-panel dvb-panel-fill' },
          el(
            'div',
            { className: 'dvb-panel-head' },
            el('span', { className: 'dvb-panel-title' }, t('outputLog')),
            buildErrors.length
              ? el('span', { className: 'dvb-badge', 'data-kind': 'err' }, buildErrors.length + ' 错误/警告')
              : null,
            lastResult && lastResult.details && (lastResult.details.log_file || lastResult.details.logFile)
              ? el(
                  'button',
                  {
                    type: 'button',
                    className: 'dvb-btn',
                    onClick: openFullLog,
                  },
                  '查看完整日志',
                )
              : null,
          ),
          buildErrors.length
            ? el(
                'div',
                { className: 'dvb-map-funcs' },
                buildErrors.slice(0, 30).map((err, idx) =>
                  el(
                    'div',
                    {
                      key: 'e' + idx,
                      className: 'dvb-map-func',
                      'data-kind': err.kind === 'error' || err.kind === 'fatal error' ? 'err' : 'warn',
                    },
                    el('span', { className: 'dvb-map-func-name' }, err.file),
                    el('span', { className: 'dvb-map-meta' }, ':' + err.line + ' ' + err.kind),
                    el('span', { className: 'dvb-hint', title: err.text }, err.text.slice(0, 120)),
                    el(
                      'button',
                      {
                        type: 'button',
                        className: 'dvb-btn dvb-btn-sm',
                        title: '打开工程结构并定位到该文件/行',
                        onClick() {
                          jumpToError(err)
                        },
                      },
                      '定位',
                    ),
                  ),
                ),
              )
            : null,
          buildOut
            ? el('pre', { className: 'dvb-log' }, buildOut)
            : el('div', { className: 'dvb-empty' }, t('outputEmpty')),
        ),
      ),
      flashPanel,
      manualPanel,
      // Task9/0.19.2: 完整时间线已迁入侧边栏"操作记录"；这里只保留轻量运行摘要
      journal && journal.running && journal.running.length
        ? el(
            'div',
            { className: 'dvb-hint' },
            t('tasks') +
              ' · 运行中 ' +
              journal.running
                .map((r) => r.summary || r.type || r.id)
                .filter(Boolean)
                .join(' / '),
          )
        : null,
      logView && logView.open
        ? el(
            'div',
            { className: 'dvb-panel dvb-write-panel' },
            el(
              'div',
              { className: 'dvb-panel-head' },
              el('span', { className: 'dvb-panel-title' }, '完整日志'),
              el('input', {
                className: 'dvb-input dvb-map-search',
                placeholder: '搜索…',
                value: logView.search,
                onChange: (event) => {
                  setLogView((prev) => ({ ...prev, search: event.target.value }))
                },
              }),
              el(CustomSelect, {
                style: { width: '96px', flex: 'none' },
                value: logView.filter,
                options: [
                  { value: 'all', label: '全部' },
                  { value: 'error', label: '仅错误' },
                  { value: 'warning', label: '仅警告' },
                ],
                onChange(val) {
                  const filter = val?.target ? val.target.value : val
                  setLogView((prev) => ({ ...prev, filter }))
                },
              }),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  onClick() {
                    if (
                      logView.text &&
                      typeof navigator !== 'undefined' &&
                      navigator.clipboard &&
                      navigator.clipboard.writeText
                    )
                      navigator.clipboard.writeText(logView.text)
                  },
                },
                '复制',
              ),
              el(
                'button',
                {
                  type: 'button',
                  className: 'dvb-btn',
                  onClick() {
                    setLogView((prev) => ({ ...prev, open: false }))
                  },
                },
                t('csvCancel'),
              ),
            ),
            logView.busy
              ? el('div', { className: 'dvb-hint' }, t('opening'))
              : logView.error
                ? el('div', { className: 'dvb-msg', 'data-kind': 'err' }, logView.error)
                : el(
                    'pre',
                    { className: 'dvb-log' },
                    (logView.text || '')
                      .split('\n')
                      .filter((line) => {
                        if (logView.filter === 'error') return /error/i.test(line)
                        if (logView.filter === 'warning') return /warning/i.test(line)
                        return true
                      })
                      .filter((line) => {
                        const s = logView.search.trim().toLowerCase()
                        return !s || line.toLowerCase().includes(s)
                      })
                      .join('\n'),
                  ),
          )
        : null,
      pickerEl,
    )
  }
}

export function registerView(ctx, React, t, DebugPage, HmiPage, MonitorPage) {
  const slots = ctx.slots
  if (slots == null || React == null) return function () {}
  const stopDebug = slots.inject('conversation.view', function () {
    return slots.register(
      {
        name: 'conversation.view',
        id: 'vision-bench-debug',
        order: 20,
        locale: NS,
        label() {
          return t('tabDebug')
        },
      },
      DebugPage,
    )
  })
  const stopHmi = slots.inject('conversation.view', function () {
    return slots.register(
      {
        name: 'conversation.view',
        id: 'vision-bench-hmi',
        order: 21,
        locale: NS,
        label() {
          return t('tabHmi')
        },
      },
      HmiPage,
    )
  })
  const stopMonitor =
    MonitorPage &&
    slots.inject('conversation.view', function () {
      return slots.register(
        {
          name: 'conversation.view',
          id: 'vision-bench-monitor',
          order: 22,
          locale: NS,
          label() {
            return t('tabMonitor')
          },
        },
        MonitorPage,
      )
    })
  return function () {
    if (typeof stopDebug === 'function') stopDebug()
    if (typeof stopHmi === 'function') stopHmi()
    if (typeof stopMonitor === 'function') stopMonitor()
  }
}
