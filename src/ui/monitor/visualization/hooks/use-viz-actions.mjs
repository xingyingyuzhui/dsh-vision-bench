// Visualization page mutations: save/remove/edit/switch-write/copy-ref.

import {
  buildAgentRef,
  dispatchAgentRef,
  evidenceFromRef,
  postEvidence,
} from '../../../common/agent-reference.mjs'
import { TREND_WINDOW_MS } from '../../../../domain/modbus/trend-model.mjs'
import {
  formatSwitchWriteNote,
  normalizeVisualizationComponent,
  validateVisualizationComponent,
} from '../../../../domain/modbus/visualization-model.mjs'

export function useVizActions(_React, deps) {
  const {
    cwd,
    post,
    props,
    agentBridge,
    pack,
    components,
    points,
    editor,
    setEditor,
    setDeleteId,
    setCanvasEditing,
    setCopied,
    setNote,
    setMb,
    setSaving,
    setTick,
    saving,
    canvasEditing,
    aliveRef,
    copyClearTimer,
    copyToken,
    switchDraft,
    vizReadOnlyRef,
    vizReadOnlyReasonRef,
    flushLayout,
    destroyChart,
  } = deps

  function rejectIfReadOnly() {
    if (!vizReadOnlyRef.current) return false
    setNote(vizReadOnlyReasonRef.current || '当前为只读模式')
    return true
  }

  function editorValidation(ed) {
    const cur = ed || editor
    if (!cur) return { ok: false, reason: '' }
    if (!String(cur.name || '').trim()) return { ok: false, reason: '请填写组件名称' }
    const cand = normalizeVisualizationComponent({ ...cur, id: cur.id || '' })
    const v = validateVisualizationComponent(cand, points)
    if (!v.ok) return { ok: false, reason: v.error || '配置无效' }
    return { ok: true, reason: '', cand }
  }

  function persistViz(op, component, visualizationId = '') {
    if (rejectIfReadOnly()) return Promise.resolve(false)
    return post('/dsh-vision-bench/command', {
      cwd,
      sessionId: props?.sessionId || '',
      source: 'user',
      action: 'visualization',
      payload: {
        action: 'visualization',
        op,
        visualizationId,
        component,
        expectedConfigVersion: pack.configVersion || 1,
      },
    })
      .then((data) => {
        if (data && data.ok === false) {
          setNote(data.errorCode === 'CONFIG_DRIFT' ? '配置已被其他操作更新，请刷新后重试' : data.error || '保存失败')
          return false
        }
        if (data?.workspace?.modbus) setMb(data.workspace.modbus)
        return true
      })
      .catch((err) => {
        setNote(String(err?.message || '保存失败'))
        return false
      })
  }

  function saveComponent() {
    if (rejectIfReadOnly()) return
    if (!editor || saving) return
    const check = editorValidation()
    if (!check.ok) {
      setNote(check.reason)
      return
    }
    const existingIndex = editor.id ? components.findIndex((c) => c.id === editor.id) : -1
    const base = existingIndex >= 0 ? components[existingIndex] : {}
    const cand = normalizeVisualizationComponent({ ...base, ...editor, id: existingIndex >= 0 ? base.id : '' })
    setSaving(true)
    persistViz(existingIndex >= 0 ? 'update' : 'add', cand, existingIndex >= 0 ? base.id : '')
      .then((ok) => {
        setSaving(false)
        if (ok) {
          if (existingIndex >= 0 && (base.type === 'line' || base.type === 'bar') && cand.type !== base.type) {
            destroyChart(base.id)
          }
          setEditor(null)
          setNote('')
        }
      })
      .catch(() => setSaving(false))
  }

  function removeComponent(id) {
    if (rejectIfReadOnly()) return
    persistViz('remove', {}, id).then((ok) => {
      if (ok) destroyChart(id)
    })
    setDeleteId('')
  }

  function openEditor(comp) {
    if (rejectIfReadOnly()) return
    if (canvasEditing) {
      flushLayout()
      setCanvasEditing(false)
    }
    setNote('')
    if (comp) setEditor({ ...comp, pointIds: (comp.pointIds || []).slice(), search: '' })
    else
      setEditor({
        id: '',
        name: `组件${components.length + 1}`,
        type: 'line',
        pointIds: [],
        order: components.length,
        settings: { windowMs: 300000, confirmWrite: true, yMin: '', yMax: '' },
        search: '',
      })
  }

  function toggleSwitch(comp, point, wantOn) {
    if (rejectIfReadOnly()) return
    if (!cwd || switchDraft.current?.busy) return
    const settings = comp.settings || {}
    const desiredValue = wantOn ? 1 : 0
    const now = Date.now()
    const pending = switchDraft.current
    const same =
      pending &&
      pending.componentId === comp.id &&
      pending.pointId === point.pointId &&
      pending.desiredValue === desiredValue &&
      pending.expiresAt > now
    if (settings.confirmWrite !== false && !same) {
      switchDraft.current = {
        componentId: comp.id,
        pointId: point.pointId,
        desiredValue,
        expiresAt: now + 10000,
        busy: false,
      }
      setNote(`再次点击「${wantOn ? '开' : '关'}」确认写入（10 秒内有效）`)
      setTick((n) => n + 1)
      return
    }
    switchDraft.current = {
      componentId: comp.id,
      pointId: point.pointId,
      desiredValue,
      expiresAt: now + 10000,
      busy: true,
    }
    setTick((n) => n + 1)
    post('/dsh-vision-bench/modbus/write', {
      cwd,
      source: 'user',
      sessionId: props?.sessionId || '',
      connectionId: point.connectionId,
      deviceId: point.deviceId,
      pointId: point.pointId,
      function: Number(point.function) || 1,
      address: point.address,
      values: [desiredValue],
    })
      .then((data) => {
        setNote(formatSwitchWriteNote(data, wantOn))
        return post('/dsh-vision-bench/state', { cwd, sessionId: props?.sessionId || undefined })
      })
      .then((data) => {
        if (data?.workspace) setMb(data.workspace.modbus)
      })
      .catch((err) => setNote(String(err?.message || '写入失败')))
      .finally(() => {
        switchDraft.current = null
        setTick((n) => n + 1)
      })
  }

  function copyComponentRef(comp) {
    const token = ++copyToken.current
    if (copyClearTimer.current) {
      clearTimeout(copyClearTimer.current)
      copyClearTimer.current = 0
    }
    const ref = buildAgentRef(
      'visualization',
      { visualizationId: comp.id, type: comp.type, pointIds: comp.pointIds, name: comp.name },
      { configVersion: pack?.configVersion || 1, start: Date.now() - TREND_WINDOW_MS, end: Date.now() },
    )
    const setDone = (msg) => {
      setCopied(msg)
      copyClearTimer.current = setTimeout(() => {
        copyClearTimer.current = 0
        if (aliveRef.current && token === copyToken.current) setCopied('')
      }, 2500)
    }
    dispatchAgentRef(ref, agentBridge)
      .then((res) => {
        if (!aliveRef.current || token !== copyToken.current) return
        if (!res || !res.ok) return setDone('复制失败')
        setDone(`${res.mode === 'input' ? '已加入输入框' : res.mode === 'sent' ? '已发送' : '已复制组件引用'} · ${comp.name}`)
      })
      .catch(() => {
        if (aliveRef.current && token === copyToken.current) setDone('复制失败')
      })
    try {
      postEvidence(post, cwd, evidenceFromRef(ref), (reason) => {
        if (aliveRef.current) setNote(reason)
      })
    } catch {}
  }

  return {
    rejectIfReadOnly,
    editorValidation,
    saveComponent,
    removeComponent,
    openEditor,
    toggleSwitch,
    copyComponentRef,
  }
}
