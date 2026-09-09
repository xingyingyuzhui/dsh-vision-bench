/**
 * Point flag and alarm toggle actions with optimistic concurrency and rollback.
 * @param {any} ctx
 * @param {any} core
 */
export function createHmiPointFlagActions(ctx, core) {
  const {
    cwd,
    sessionId,
    commandClient,
    setError,
    setWorkspace,
    workspaceRef,
    flagInflight,
    setFlagSavingByPoint,
    flagRequestSeq,
    post,
  } = ctx
  const { normalizePack } = core

  function applyPointFlagLocal(pointId, patch) {
    setWorkspace((prev) => {
      const points = prev.modbus?.points || []
      const nextPoints = points.map((p) => {
        if (p.id !== pointId) return p
        const next = { ...p, ...patch }
        if (patch.monitorEnabled !== undefined) next.trendEnabled = patch.monitorEnabled === true
        return next
      })
      const next = { ...prev, modbus: { ...prev.modbus, points: nextPoints } }
      workspaceRef.current = next
      return next
    })
  }

  function validateAlarmEnable(point) {
    const minRaw = point?.alarmMin
    const maxRaw = point?.alarmMax
    const hasMin = minRaw !== null && minRaw !== undefined && minRaw !== ''
    const hasMax = maxRaw !== null && maxRaw !== undefined && maxRaw !== ''
    if (!hasMin && !hasMax) return { ok: true, warn: '尚未配置阈值' }
    if (hasMin && hasMax) {
      const min = Number(minRaw)
      const max = Number(maxRaw)
      if (!(Number.isFinite(min) && Number.isFinite(max) && min < max)) {
        return { ok: false, error: '告警上下限非法，无法开启' }
      }
    }
    return { ok: true }
  }

  function persistPointFlags(pointId, patch) {
    if (!cwd || !pointId || !patch || typeof patch !== 'object') return Promise.resolve()
    const keys = Object.keys(patch).filter((k) => k === 'monitorEnabled' || k === 'alarmEnabled')
    if (!keys.length) return Promise.resolve()

    const packNow = normalizePack()
    const current = (packNow.points || []).find((p) => p.id === pointId)
    if (!current) {
      setError('点位不存在')
      return Promise.resolve()
    }

    if (patch.alarmEnabled === true) {
      const check = validateAlarmEnable(current)
      if (!check.ok) {
        setError(check.error)
        return Promise.resolve()
      }
      if (check.warn) setError(check.warn)
    }

    const prevSnapshot = {
      monitorEnabled: current.monitorEnabled === true,
      alarmEnabled: current.alarmEnabled === true,
      trendEnabled: current.trendEnabled === true,
    }
    const seqKeys = keys.map((k) => pointId + ':' + k)
    for (const sk of seqKeys) {
      flagRequestSeq.current[sk] = (flagRequestSeq.current[sk] || 0) + 1
    }
    const seqAtStart = Object.fromEntries(seqKeys.map((sk) => [sk, flagRequestSeq.current[sk]]))

    applyPointFlagLocal(pointId, patch)
    flagInflight.current += 1
    setFlagSavingByPoint((prev) => {
      const next = { ...prev }
      for (const sk of seqKeys) next[sk] = true
      return next
    })

    const sid = sessionId || workspaceRef?.current?.session?.boundId || ''
    const body = {
      cwd,
      pointId,
      expectedConfigVersion: packNow.configVersion || 1,
    }
    if (sid) body.sessionId = sid
    for (const k of keys) body[k] = patch[k] === true

    const isLatest = () => seqKeys.every((sk) => seqAtStart[sk] === flagRequestSeq.current[sk])

    const rollbackPatch = {}
    if (keys.includes('monitorEnabled')) {
      rollbackPatch.monitorEnabled = prevSnapshot.monitorEnabled
      rollbackPatch.trendEnabled = prevSnapshot.trendEnabled
    }
    if (keys.includes('alarmEnabled')) {
      rollbackPatch.alarmEnabled = prevSnapshot.alarmEnabled
    }

    const rollback = (msg) => {
      if (!isLatest()) return
      applyPointFlagLocal(pointId, rollbackPatch)
      if (msg) setError(msg)
    }

    const recoverFromFailure = (msg) => {
      if (!isLatest()) return Promise.resolve()
      return commandClient
        .refresh()
        .then((fresh) => {
          if (!isLatest()) return
          if (fresh?.workspace?.modbus) {
            setWorkspace((prev) => {
              const next = { ...prev, modbus: fresh.workspace.modbus }
              workspaceRef.current = next
              return next
            })
            if (msg) setError(msg)
            return
          }
          rollback(msg)
        })
        .catch(() => rollback(msg))
    }

    const applySuccess = (data) => {
      if (!isLatest()) return data
      if (data.workspace?.modbus) {
        setWorkspace((prev) => {
          const next = { ...prev, modbus: data.workspace.modbus }
          workspaceRef.current = next
          return next
        })
      } else if (data.point?.id) {
        applyPointFlagLocal(pointId, {
          monitorEnabled: data.point.monitorEnabled === true,
          alarmEnabled: data.point.alarmEnabled === true,
          trendEnabled: data.point.monitorEnabled === true,
        })
        if (data.configVersion != null) {
          setWorkspace((prev) => {
            const next = { ...prev, modbus: { ...prev.modbus, configVersion: data.configVersion } }
            workspaceRef.current = next
            return next
          })
        }
      }
      setError('')
      return data
    }

    const sendFlagPatch = (expectedConfigVersion) =>
      post('/dsh-vision-bench/points/flags', { ...body, expectedConfigVersion })

    return sendFlagPatch(packNow.configVersion || 1)
      .then((data) => {
        if (!isLatest()) return data
        if (!data || data.ok === false) {
          const code = data?.errorCode
          if (code === 'CONFIG_DRIFT') {
            return commandClient
              .refresh()
              .then((fresh) => {
                if (!isLatest()) return data
                const currentVersion = fresh?.workspace?.modbus?.configVersion
                if (!currentVersion) return data
                return sendFlagPatch(currentVersion)
              })
              .then((data2) => {
                if (!isLatest()) return data2
                if (!data2 || data2.ok === false) {
                  const errMsg = data2?.error ? `（${data2.error}）` : ''
                  return recoverFromFailure(`点位配置更新失败${errMsg}，请重试`).then(() => data2)
                }
                return applySuccess(data2)
              })
              .catch(() => recoverFromFailure('点位配置已被其他操作更新，请重试'))
          }
          const defaultTip =
            keys[0] === 'monitorEnabled' ? '监视状态保存失败，已恢复原状态' : '告警状态保存失败，已恢复原状态'
          const tip = data?.error
            ? `${keys[0] === 'monitorEnabled' ? '监视' : '告警'}状态保存失败（${data.error}），已恢复原状态`
            : defaultTip
          return recoverFromFailure(tip).then(() => data)
        }
        return applySuccess(data)
      })
      .catch((err) => {
        const errMsg = err?.message ? `（${err.message}）` : ''
        return recoverFromFailure(
          `${keys[0] === 'monitorEnabled' ? '监视' : '告警'}状态保存失败${errMsg}，已恢复原状态`,
        )
      })
      .finally(() => {
        flagInflight.current = Math.max(0, flagInflight.current - 1)
        setFlagSavingByPoint((prev) => {
          const next = { ...prev }
          for (const sk of seqKeys) {
            if (seqAtStart[sk] === flagRequestSeq.current[sk]) delete next[sk]
          }
          return next
        })
      })
  }

  return {
    applyPointFlagLocal,
    validateAlarmEnable,
    persistPointFlags,
  }
}
