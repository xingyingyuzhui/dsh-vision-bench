// TaskP2/0.20.0: GridStack 布局同步 Hook
// 负责处理网格拖拽移动/缩放后的 300ms 防抖提交、增量去重比对、CONFIG_DRIFT 重试及组件卸载保护。

/**
 * @param {object} React
 * @param {object} deps
 * @param {string} deps.cwd
 * @param {string} [deps.sessionId]
 * @param {Function} deps.post
 * @param {React.MutableRefObject<any>} deps.packRef
 * @param {Function} deps.setMb
 * @param {Function} deps.setNote
 * @param {React.MutableRefObject<boolean>} deps.vizReadOnlyRef
 * @param {React.MutableRefObject<boolean>} deps.aliveRef
 */
export function useVizLayout(React, { cwd, sessionId, post, packRef, setMb, setNote, vizReadOnlyRef, aliveRef }) {
  const layoutTimer = React.useRef(0)
  const layoutInflight = React.useRef(false)
  const layoutQueued = React.useRef(false)
  const layoutDraft = React.useRef(null)

  React.useEffect(() => {
    return () => {
      if (layoutTimer.current) {
        clearTimeout(layoutTimer.current)
        layoutTimer.current = 0
      }
    }
  }, [])

  function resetLayout() {
    layoutDraft.current = null
    layoutQueued.current = false
    if (layoutTimer.current) {
      clearTimeout(layoutTimer.current)
      layoutTimer.current = 0
    }
  }

  function layoutOf(comp) {
    return layoutDraft.current?.[comp.id] || comp.layout || { x: 0, y: 0, w: 6, h: 4 }
  }

  function flushLayout() {
    if (vizReadOnlyRef.current) {
      layoutDraft.current = null
      layoutQueued.current = false
      return
    }
    if (!aliveRef.current) return
    if (layoutInflight.current) {
      layoutQueued.current = true
      return
    }
    const draft = layoutDraft.current
    if (!draft || !Object.keys(draft).length) return
    const items = Object.keys(draft).map((id) => ({ id, ...draft[id] }))
    const sent = { ...draft }
    const version = packRef.current?.configVersion || 1
    layoutInflight.current = true
    post('/dsh-vision-bench/command', {
      cwd,
      sessionId: sessionId || '',
      source: 'user',
      action: 'visualization',
      payload: {
        action: 'visualization',
        op: 'layout',
        items,
        expectedConfigVersion: version,
      },
    })
      .then((data) => {
        if (!aliveRef.current) return
        if (data && data.ok === false) {
          if (data.errorCode === 'CONFIG_DRIFT') {
            return post('/dsh-vision-bench/state', { cwd, sessionId: sessionId || '' }).then((fresh) => {
              if (!aliveRef.current) return
              if (fresh?.workspace?.modbus) setMb(fresh.workspace.modbus)
              layoutQueued.current = true
            })
          }
          setNote(data.error || '布局保存失败')
          return
        }
        if (data?.workspace?.modbus) setMb(data.workspace.modbus)
        const cur = layoutDraft.current || {}
        const next = {}
        for (const id of Object.keys(cur)) {
          const a = cur[id]
          const b = sent[id]
          if (a && b && a.x === b.x && a.y === b.y && a.w === b.w && a.h === b.h) continue
          next[id] = a
        }
        layoutDraft.current = Object.keys(next).length ? next : null
      })
      .catch((err) => {
        if (aliveRef.current) setNote(String(err?.message || '布局保存失败'))
      })
      .finally(() => {
        layoutInflight.current = false
        if (layoutQueued.current && aliveRef.current) {
          layoutQueued.current = false
          flushLayout()
        }
      })
  }

  function persistLayout(items) {
    if (vizReadOnlyRef.current) return
    if (!cwd || !packRef.current || !Array.isArray(items) || !items.length) return
    const draft = { ...(layoutDraft.current || {}) }
    for (const item of items) {
      if (!item || !item.id) continue
      draft[item.id] = { x: item.x, y: item.y, w: item.w, h: item.h }
    }
    layoutDraft.current = draft
    if (layoutTimer.current) clearTimeout(layoutTimer.current)
    layoutTimer.current = setTimeout(() => {
      layoutTimer.current = 0
      flushLayout()
    }, 300)
  }

  return {
    layoutDraft,
    layoutOf,
    persistLayout,
    flushLayout,
    resetLayout,
  }
}
