// Structured Agent references, evidence, clipboard, input bridge (split from bench-shared).
// Structured Agent reference for “让 Agent 分析” — stable ID + configVersion + timeRange
// Task4/0.18.2: kind decides which id field carries the target:
//   point → pointId, frame → frameId, alarm → alarmId, trend → trendKey
// trendKey must be connectionId:deviceId:pointId and backfills those ids.
export const parseTrendKey = (key) => {
  if (typeof key !== 'string') return null
  const parts = key.split(':')
  if (parts.length !== 3) return null
  const [a, b, c] = parts.map((x) => x.trim())
  if (!a || !b || !c) return null
  return { connectionId: a, deviceId: b, pointId: c }
}

export function buildAgentRef(kind, payload, opts) {
  const now = Date.now()
  const k = String(kind || 'point')
  const base = {
    kind: k,
    at: now,
    configVersion: opts && opts.configVersion != null ? Number(opts.configVersion) : 3,
  }
  if (payload && typeof payload === 'object') {
    const p = payload
    const connId = String(p.connectionId || p.connId || opts?.connectionId || '').slice(0, 64)
    base.connectionId = connId
    base.deviceId = String(p.deviceId || opts?.deviceId || '').slice(0, 64)
    base.pointId = ''
    base.frameId = ''
    base.alarmId = ''
    base.trendKey = ''
    if (k === 'trend') {
      const tk = String(p.trendKey || p.key || p.id || '').slice(0, 96)
      if (tk) {
        const parsed = parseTrendKey(tk)
        if (!parsed) throw new Error(`trendKey 格式应为 connectionId:deviceId:pointId: ${tk}`)
        base.connectionId = base.connectionId || parsed.connectionId
        base.deviceId = base.deviceId || parsed.deviceId
        base.pointId = parsed.pointId
        base.trendKey = tk
      }
    } else if (k === 'point') {
      base.pointId = String(p.pointId || p.id || opts?.pointId || '').slice(0, 64)
    } else if (k === 'frame') {
      base.frameId = String(p.frameId || p.id || opts?.frameId || '').slice(0, 64)
    } else if (k === 'alarm') {
      base.alarmId = String(p.alarmId || p.id || opts?.alarmId || '').slice(0, 64)
      // alarm refs keep explicit point context in its own typed field
      if (p.pointId) base.pointId = String(p.pointId).slice(0, 64)
    } else if (k === 'visualization') {
      base.pointId = String(p.pointIds?.[0] || p.pointId || opts?.pointId || '').slice(0, 64)
      base.visualizationId = String(p.visualizationId || p.id || '').slice(0, 64)
      base.componentType = String(p.type || 'line').slice(0, 16)
      base.pointIds = (Array.isArray(p.pointIds) ? p.pointIds : []).slice(0, 16).map((x) => String(x))
    } else {
      // generic targets (connection/device/focus/…) carry only what was given
      base.pointId = String(p.pointId || p.id || opts?.pointId || '').slice(0, 64)
      base.frameId = String(p.frameId || opts?.frameId || '').slice(0, 64)
      base.alarmId = String(p.alarmId || opts?.alarmId || '').slice(0, 64)
      base.trendKey = String(p.trendKey || opts?.trendKey || '').slice(0, 96)
    }
    if (p.start != null || p.end != null) {
      base.timeRange = {
        start: Number(p.start ?? opts?.start ?? now - 5 * 60 * 1000),
        end: Number(p.end ?? opts?.end ?? now),
      }
    } else if (opts && (opts.start != null || opts.end != null)) {
      base.timeRange = { start: Number(opts.start ?? now - 5 * 60 * 1000), end: Number(opts.end ?? now) }
    } else {
      base.timeRange = { start: now - 5 * 60 * 1000, end: now }
    }
    // Include human label if available
    if (p.name || p.label) base.label = String(p.name || p.label).slice(0, 80)
  } else {
    base.timeRange = { start: now - 5 * 60 * 1000, end: now }
  }
  return base
}

// Task4/0.18.2: map an agent ref to the standard evidence shape
// { kind, id, connectionId, deviceId, pointId, frameId, trendKey, alarmId, at, version, timeRange }
export function evidenceFromRef(ref) {
  const r = ref || {}
  const kind = String(r.kind || 'point')
  const at = Number(r.at) > 0 ? Number(r.at) : Date.now()
  const timeRange =
    r.timeRange && Number.isFinite(Number(r.timeRange.start))
      ? {
          start: Number(r.timeRange.start),
          end:
            Number(r.timeRange.end) >= Number(r.timeRange.start) ? Number(r.timeRange.end) : Number(r.timeRange.start),
        }
      : { start: at - 5 * 60 * 1000, end: at }
  let pointId = ''
  let frameId = ''
  let trendKey = ''
  let alarmId = ''
  let visualizationId = ''
  let componentType = ''
  let pointIds = []
  let snapshotId = ''
  let debugSessionId = ''
  let reason = ''
  let file = ''
  let line = 0
  let firmwareHash = ''
  if (kind === 'point') pointId = String(r.pointId || '')
  else if (kind === 'frame') frameId = String(r.frameId || '')
  else if (kind === 'alarm') alarmId = String(r.alarmId || '')
  else if (kind === 'trend') {
    trendKey = String(r.trendKey || '')
    pointId = String(r.pointId || '')
  } else if (kind === 'visualization') {
    visualizationId = String(r.visualizationId || r.id || '')
    componentType = String(r.componentType || r.type || '').slice(0, 16)
    pointIds = (Array.isArray(r.pointIds) ? r.pointIds : []).slice(0, 16).map((x) => String(x))
    pointId = String(pointIds[0] || r.pointId || '')
  } else if (kind === 'debug_snapshot') {
    snapshotId = String(r.snapshotId || r.id || '')
    debugSessionId = String(r.debugSessionId || '')
    reason = String(r.reason || '')
    file = String(r.file || '')
    line = Number(r.line) || 0
    firmwareHash = String(r.firmwareHash || '')
  } else pointId = String(r.pointId || '')
  const id =
    snapshotId ||
    visualizationId ||
    pointId ||
    frameId ||
    trendKey ||
    alarmId ||
    String(r.connectionId || '') ||
    String(r.deviceId || '')
  const out = {
    kind,
    id,
    connectionId: String(r.connectionId || ''),
    deviceId: String(r.deviceId || ''),
    pointId,
    frameId,
    trendKey,
    alarmId,
    at,
    version: Number(r.configVersion) > 0 ? Number(r.configVersion) : 1,
    timeRange,
  }
  if (kind === 'visualization') {
    out.visualizationId = visualizationId
    out.componentType = componentType
    out.pointIds = pointIds
  }
  if (kind === 'debug_snapshot' || snapshotId) {
    out.snapshotId = snapshotId
    out.debugSessionId = debugSessionId
    out.reason = reason
    out.file = file
    out.line = line
    out.firmwareHash = firmwareHash
  }
  return out
}

// Task4/0.18.2: evidence POST must surface CONFIG_DRIFT / TARGET_MISMATCH reasons,
// never a silent .catch(() => {}). onFail receives the human reason.
export function postEvidence(post, cwd, evidence, onFail) {
  if (typeof post !== 'function' || !cwd) return Promise.resolve(null)
  const list = Array.isArray(evidence) ? evidence : evidence ? [evidence] : []
  if (!list.length) return Promise.resolve(null)
  return post('/dsh-vision-bench/evidence', { cwd, evidence: list }, 15000)
    .then((data) => {
      if (data && data.ok === false) {
        if (typeof onFail === 'function') {
          onFail(
            (data.errorCode && data.errorCode !== 'CONFIG_DRIFT' && data.errorCode !== 'TARGET_MISMATCH'
              ? ''
              : data.errorCode
                ? `${data.errorCode}: `
                : '') + (data.error || '证据保存失败'),
          )
        }
      }
      return data
    })
    .catch((err) => {
      if (typeof onFail === 'function') onFail(`证据保存失败: ${String(err?.message || err)}`)
      return null
    })
}

export function agentRefToText(ref) {
  // 剪贴板回退也必须是完整 JSON，不能丢 visualizationId / pointIds
  return JSON.stringify(ref || {}, null, 2)
}

export async function copyAgentRef(ref) {
  const text = JSON.stringify(ref, null, 2)
  try {
    if (typeof navigator !== 'undefined' && navigator.clipboard && navigator.clipboard.writeText) {
      await navigator.clipboard.writeText(text)
      return true
    }
  } catch {}
  return false
}

// Task5/0.18.2: Session Agent input bridge. dispatchAgentRef is a PURE command:
// the bridge carries { currentDraft, setDraft, submit } and no React hook is ever
// called inside dispatch (hooks are read at component render top level only).

// Read the draft via the harness reader hook — call this at the TOP of a render,
// never inside an event handler (prevents Invalid Hook Call).
export function readInputDraft(useInput) {
  if (typeof useInput !== 'function') return ''
  try {
    const v = useInput((s) => s?.draft || '')
    return typeof v === 'string' ? v : ''
  } catch {
    return ''
  }
}

// Resolve writer actions from harness props; keep reader value out of dispatch.
export function buildInputBridge(props, currentDraft) {
  const actions = props?.inputActions || props?.session?.inputActions || null
  return {
    currentDraft: typeof currentDraft === 'string' ? currentDraft : '',
    setDraft: actions && typeof actions.setDraft === 'function' ? actions.setDraft : null,
    submit: actions && typeof actions.submit === 'function' ? actions.submit : null,
  }
}

export async function dispatchAgentRef(ref, bridge, opts) {
  const t = JSON.stringify(ref, null, 2)
  const b = bridge || {}
  const hasWriter = typeof b.setDraft === 'function'
  if (hasWriter) {
    try {
      // 追加规则：不覆盖用户已有文本，换行后接序列化引用
      const cur = typeof b.currentDraft === 'string' ? b.currentDraft : ''
      const next = cur ? `${cur}\n${t}` : t
      b.setDraft(next)
      if (opts?.send && typeof b.submit === 'function') {
        try {
          b.submit()
          return { mode: 'sent', ok: true, status: '已发送', text: t }
        } catch {}
      }
      return { mode: 'input', ok: true, status: '已加入输入框', text: t }
    } catch {}
  }
  // 无写接口 → 剪贴板回退（完整 JSON）；权限失败不得提示成功
  const ok = await copyAgentRef(ref)
  return {
    mode: ok ? 'copied' : 'failed',
    ok: !!ok,
    status: ok ? '已复制组件引用' : '复制失败',
    text: t,
    fallback: true,
  }
}
export const hasHarnessInput = (p) =>
  !!(
    p &&
    ((p.inputActions && typeof p.inputActions.setDraft === 'function') ||
      (p.session?.inputActions && typeof p.session.inputActions.setDraft === 'function'))
  )
