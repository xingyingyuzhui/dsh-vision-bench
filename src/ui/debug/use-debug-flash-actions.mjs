import {
  DEFAULT_OPENOCD_INTERFACE,
  DEFAULT_OPENOCD_TARGET,
} from '../../domain/flash/openocd-profile.mjs'

/**
 * Flash download / OpenOCD probe state. Owns its own async mutable refs;
 * does not share objects with build or workspace hooks.
 *
 * @param {any} React
 * @param {(key: string) => string} t
 * @param {(path: string, body?: any, timeout?: number) => Promise<any>} post
 * @param {string} cwd
 * @param {string} sessionId
 * @param {(data: any) => any} mergeState
 */
export function useDebugFlashActions(React, t, post, cwd, sessionId, mergeState) {
  const mergeStateRef = React.useRef(mergeState)
  mergeStateRef.current = mergeState

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

  function probeOpenOcd(opts) {
    const force = !!opts?.force
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
          versionLine: probe?.versionLine || '',
          path: boundPath,
        })
      })
      .catch((err) => {
        if (unmountedRef.current || seq !== probeSeqRef.current) return
        setOpenocdFlash({
          status: 'failed',
          reason: String(err?.message || 'OpenOCD 探测失败'),
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
    return () => {
      unmountedRef.current = true
      const cur = flashRef.current
      const id = cur?.confirm?.requestId
      if (id && !cur.busy && !cancelSentRef.current) {
        cancelSentRef.current = true
        post(
          '/dsh-vision-bench/keil/download',
          { cwd, requestId: id, approved: false, source: 'user', sessionId },
          15000,
        ).catch(() => {})
      }
    }
  }, [cwd, post, sessionId])

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
        if (data?.needsConfirm) {
          setFlash((prev) => ({ ...prev, busy: false, confirm: data.request }))
          return null
        }
        setFlash((prev) => ({ ...prev, busy: false, confirm: null, result: data }))
        return post('/dsh-vision-bench/state', { cwd })
      })
      .then((data) => mergeStateRef.current(data))
      .catch((err) => {
        setFlash((prev) => ({
          ...prev,
          busy: false,
          result: { ok: false, error: String(err?.message || t('fail')) },
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
      .then((data) => mergeStateRef.current(data))
      .catch((err) => {
        setFlash((prev) => ({
          ...prev,
          busy: false,
          confirm: null,
          result: { ok: false, error: String(err?.message || t('fail')) },
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
        if (data?.cancelled) {
          cancelSentRef.current = true
          setFlash((prev) => ({ ...prev, confirm: null, cancelBusy: false, busy: false, result: null }))
          return
        }
        setFlash((prev) => ({
          ...prev,
          cancelBusy: false,
          result: { ok: false, error: data?.error || t('flashCancelFail') },
        }))
      })
      .catch((err) => {
        if (unmountedRef.current) return
        setFlash((prev) => ({
          ...prev,
          cancelBusy: false,
          result: { ok: false, error: String(err?.message || t('flashCancelFail')) },
        }))
      })
  }

  return {
    flash,
    setFlash,
    openocdFlash,
    probeOpenOcd,
    startFlash,
    approveFlash,
    cancelFlash,
  }
}
