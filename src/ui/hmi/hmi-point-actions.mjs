import { csvToPoints, pointsToCsv } from '../../../bench-points.mjs'
import { AREA_BY_FN_EDIT, hmiGenId } from './hmi-ids.mjs'

/** Point table, flags, drafts, and CSV actions. */
export function createHmiPointActions(ctx, core) {
  const {
    t,
    post,
    cwd,
    commandClient,
    setError,
    setWorkspace,
    workspaceRef,
    flagInflight,
    setEditingDeviceId,
    setEditingPointsDeviceId,
    deviceDraft,
    setDeviceDraft,
    pointDraftsById,
    setPointDraftsById,
    newPointDraft,
    setNewPointDraft,
    setInlineWrite,
    batch,
    setBatch,
    csvText,
    setCsvText,
    csvTarget,
    setCsvTarget,
    setCsvNote,
    setFlagSavingByPoint,
    flagRequestSeq,
  } = ctx
  const { normalizePack, persist, activeConnIdOf } = core

  function pointsOfDevice(devId) {
    const packNow = normalizePack()
    const active = packNow.activeConnectionId || packNow.connections[0]?.id || ''
    return (packNow.points || []).filter((p) => (p.connectionId || p.connId) === active && (p.deviceId || '') === devId)
  }

  function generateBatch() {
    const pack = normalizePack()
    const fixedCid = batch.connectionId || pack.activeConnectionId || pack.connections[0]?.id || ''
    const fixedDid = batch.deviceId
    if (!fixedDid) {
      setError('请先选择设备')
      return
    }
    const count = Math.max(1, Math.min(Number(batch.count) || 1, 64))
    const existingIds = new Set(
      (pack.points || [])
        .filter((p) => (p.connectionId || p.connId) === fixedCid && (p.deviceId || '') === fixedDid)
        .map((p) => p.id),
    )
    const existingAddr = new Set(
      (pack.points || [])
        .filter(
          (p) =>
            (p.connectionId || p.connId) === fixedCid &&
            (p.deviceId || '') === fixedDid &&
            p.function === Number(batch.fc),
        )
        .map((p) => p.address),
    )
    const additions = []
    for (let i = 0; i < count; i++) {
      const address = Number(batch.start) + i
      if (existingAddr.has(address)) continue
      const id = hmiGenId('p')
      if (existingIds.has(id)) continue
      additions.push({
        id,
        connectionId: fixedCid,
        connId: fixedCid,
        deviceId: fixedDid,
        name: (batch.prefix || '') + i,
        function: Number(batch.fc),
        address,
        area: Number(batch.fc) === 1 ? 'coil' : 'holdingRegister',
        scale: 1,
        offset: 0,
        unit: '',
        trendEnabled: false,
        alarmMin: null,
        alarmMax: null,
      })
    }
    if (!additions.length) {
      setError('批量点位的地址全部与现有点位重复')
      return
    }
    setError('')
    setBatch((prev) => ({ ...prev, open: false }))
    persist({ points: (pack.points || []).concat(additions), version: 3 })
  }

  function removePointRow(point) {
    const pack = normalizePack()
    persist({
      points: (pack.points || []).filter((p) => p.id !== point.id),
      values: (pack.values || []).filter((v) => (v.key || v.pointId) !== point.id),
      version: 3,
    })
  }

  function enterDeviceEdit(d) {
    setError('')
    setNewPointDraft(null)
    setEditingPointsDeviceId('')
    setPointDraftsById({})
    setEditingDeviceId(d.id)
    setDeviceDraft({ id: d.id, name: d.name, unitId: d.unitId, connectionId: d.connectionId })
  }

  function enterPointsEdit(d) {
    setError('')
    setNewPointDraft(null)
    setEditingDeviceId('')
    setDeviceDraft(null)
    setEditingPointsDeviceId(d.id)
    const drafts = {}
    for (const pt of pointsOfDevice(d.id)) {
      drafts[pt.id] = {
        id: pt.id,
        connectionId: pt.connectionId,
        deviceId: pt.deviceId,
        name: pt.name || '',
        function: pt.function,
        area: pt.area || AREA_BY_FN_EDIT[pt.function] || 'holdingRegister',
        address: pt.address,
        scale: pt.scale,
        offset: pt.offset,
        unit: pt.unit || '',
        alarmMin: pt.alarmMin == null ? '' : String(pt.alarmMin),
        alarmMax: pt.alarmMax == null ? '' : String(pt.alarmMax),
      }
    }
    setPointDraftsById(drafts)
  }

  function patchDraft(pointId, patch) {
    setPointDraftsById((prev) => {
      const cur = { ...(prev[pointId] || {}), ...patch }
      if (patch.function !== undefined) {
        const fn = Math.trunc(Number(patch.function))
        if (AREA_BY_FN_EDIT[fn]) cur.area = AREA_BY_FN_EDIT[fn]
        cur.function = fn
      }
      return { ...prev, [pointId]: cur }
    })
  }

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

    const body = {
      cwd,
      pointId,
      expectedConfigVersion: packNow.configVersion || 1,
    }
    for (const k of keys) body[k] = patch[k] === true

    const isLatest = () => seqKeys.every((sk) => seqAtStart[sk] === flagRequestSeq.current[sk])

    const rollback = (msg) => {
      if (!isLatest()) return
      applyPointFlagLocal(pointId, {
        monitorEnabled: prevSnapshot.monitorEnabled,
        alarmEnabled: prevSnapshot.alarmEnabled,
        trendEnabled: prevSnapshot.trendEnabled,
      })
      if (msg) setError(msg)
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
                  rollback('点位配置已被其他操作更新，请重试')
                  return data2
                }
                return applySuccess(data2)
              })
              .catch(() => rollback('点位配置已被其他操作更新，请重试'))
          }
          const tip = keys[0] === 'monitorEnabled' ? '监视状态保存失败，已恢复原状态' : '告警状态保存失败，已恢复原状态'
          rollback(tip)
          return data
        }
        return applySuccess(data)
      })
      .catch(() => {
        rollback(keys[0] === 'monitorEnabled' ? '监视状态保存失败，已恢复原状态' : '告警状态保存失败，已恢复原状态')
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

  function addNewPointRow(deviceId) {
    const activeConnId = activeConnIdOf()
    setError('')
    setInlineWrite(null)
    setEditingDeviceId('')
    setDeviceDraft(null)
    setBatch((prev) => ({ ...prev, open: false, deviceId: deviceId, connectionId: activeConnId }))
    setNewPointDraft({
      connectionId: activeConnId,
      deviceId,
      name: '',
      function: 3,
      address: 0,
      scale: 1,
      offset: 0,
      unit: '',
      monitorEnabled: true,
      alarmEnabled: false,
      alarmMin: '',
      alarmMax: '',
    })
  }

  function saveNewPointDraft() {
    const d = newPointDraft
    if (!d) return
    const pack = normalizePack()
    const fnNum = Math.trunc(Number(d.function) || 3)
    const addrNum = Math.trunc(Number(d.address))
    if (!Number.isFinite(addrNum) || addrNum < 0 || addrNum > 65535) {
      setError(t('ptAddr') + ' 0–65535')
      return
    }
    const dup = (pack.points || []).some(
      (p) =>
        (p.connectionId || p.connId) === d.connectionId &&
        (p.deviceId || '') === d.deviceId &&
        p.function === fnNum &&
        p.address === addrNum,
    )
    if (dup) {
      setError('该设备下已存在相同功能码和地址的点位')
      return
    }
    const alarmOn = d.alarmEnabled === true
    const min = alarmOn && d.alarmMin !== '' ? Number(d.alarmMin) : null
    const max = alarmOn && d.alarmMax !== '' ? Number(d.alarmMax) : null
    if (alarmOn && min != null && max != null && !(min < max)) {
      setError('下限必须小于上限')
      return
    }
    persist({
      points: (pack.points || []).concat([
        {
          id: hmiGenId('p'),
          connectionId: d.connectionId,
          connId: d.connectionId,
          deviceId: d.deviceId,
          name: String(d.name || '').slice(0, 40),
          function: fnNum,
          address: addrNum,
          scale: Number(d.scale) || 1,
          offset: Number(d.offset) || 0,
          unit: String(d.unit || '').slice(0, 12),
          monitorEnabled: d.monitorEnabled === true,
          alarmEnabled: alarmOn,
          alarmMin: Number.isFinite(min) ? min : null,
          alarmMax: Number.isFinite(max) ? max : null,
          trendEnabled: d.monitorEnabled === true,
          area:
            fnNum === 1 ? 'coil' : fnNum === 2 ? 'discreteInput' : fnNum === 4 ? 'inputRegister' : 'holdingRegister',
        },
      ]),
      version: 3,
    })
    setNewPointDraft(null)
  }

  function saveDeviceEdit(d) {
    const pack = normalizePack()
    const meta = deviceDraft
    if (!meta) return
    const name = String(meta.name || '')
      .trim()
      .slice(0, 40)
    if (!name) {
      setError('请填写设备名称')
      return
    }
    const unitId = Math.trunc(Number(meta.unitId))
    if (!Number.isFinite(unitId) || unitId < 1 || unitId > 247) {
      setError('站号 1–247')
      return
    }
    if ((pack.devices || []).some((x) => x.connectionId === d.connectionId && x.id !== d.id && x.unitId === unitId)) {
      setError('该连接内站号 ' + unitId + ' 已存在')
      return
    }
    persist({
      devices: (pack.devices || []).map((x) => (x.id === d.id ? { ...x, name, unitId } : x)),
      version: 3,
    })
    setEditingDeviceId('')
    setDeviceDraft(null)
  }

  function savePointsEdit(d) {
    const pack = normalizePack()
    const drafts = pointDraftsById || {}
    const keyOf = (p) => (p.connectionId || '') + '|' + (p.deviceId || '') + '|' + p.function + '|' + p.address
    const seen = new Map()
    for (const dOf of Object.values(drafts)) {
      if (seen.has(keyOf(dOf))) {
        setError('该设备下已存在相同功能码和地址的点位')
        return
      }
      seen.set(keyOf(dOf), dOf)
    }
    try {
      const nextPoints = (pack.points || []).map((p) => {
        const dr = drafts[p.id]
        if (!dr || (p.deviceId || '') !== d.id) return p
        const min = dr.alarmMin !== '' ? Number(dr.alarmMin) : null
        const max = dr.alarmMax !== '' ? Number(dr.alarmMax) : null
        if (p.alarmEnabled === true && min != null && max != null && !(min < max)) {
          throw new Error('下限必须小于上限: ' + (dr.name || p.name))
        }
        const fn = Math.trunc(Number(dr.function) || p.function)
        return {
          ...p,
          name: String(dr.name || '').slice(0, 40) || p.name,
          function: [1, 2, 3, 4].includes(fn) ? fn : p.function,
          area: AREA_BY_FN_EDIT[fn] || p.area,
          address: Math.trunc(Number(dr.address)),
          scale: Number(dr.scale) || 1,
          offset: Number(dr.offset) || 0,
          unit: String(dr.unit || '').slice(0, 12),
          alarmMin: Number.isFinite(min) ? min : null,
          alarmMax: Number.isFinite(max) ? max : null,
        }
      })
      persist({ points: nextPoints, version: 3 })
      setEditingPointsDeviceId('')
      setPointDraftsById({})
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  function cancelDeviceEdit() {
    setEditingDeviceId('')
    setDeviceDraft(null)
  }

  function cancelPointsEdit() {
    setEditingPointsDeviceId('')
    setPointDraftsById({})
    setNewPointDraft(null)
  }

  function exportCsv(deviceId) {
    const pack = normalizePack()
    const filtered = (pack.points || []).filter((p) => (p.deviceId || '') === (deviceId || ''))
    navigator.clipboard
      .writeText(pointsToCsv(filtered))
      .then(() => {
        setCsvNote(t('csvDone'))
        setTimeout(() => setCsvNote(''), 1500)
      })
      .catch(() => {})
  }

  function importCsv() {
    const parsed = csvToPoints(csvText)
    if (!parsed.ok) {
      setError(parsed.error)
      return
    }
    const pack = normalizePack()
    const fixedCid = pack.activeConnectionId || pack.connections[0]?.id || ''
    const fixedDid = csvTarget.deviceId
    if (!fixedDid) {
      setError('请先选择设备再导入 CSV')
      return
    }
    const withConn = parsed.points.map((p) => ({
      ...p,
      id: p.id || hmiGenId('p'),
      connectionId: fixedCid,
      connId: fixedCid,
      deviceId: fixedDid,
      trendEnabled: p.trendEnabled === true,
      area:
        p.function === 1
          ? 'coil'
          : p.function === 2
            ? 'discreteInput'
            : p.function === 4
              ? 'inputRegister'
              : 'holdingRegister',
    }))
    setError('')
    setCsvTarget((prev) => ({ ...prev, open: false }))
    setCsvText('')
    const mode = csvTarget.mode === 'replace' ? 'replace' : 'merge'
    if (mode === 'replace') {
      const gone = new Set(
        (pack.points || [])
          .filter((p) => (p.connectionId || p.connId) === fixedCid && (p.deviceId || '') === fixedDid)
          .map((p) => p.id),
      )
      const kept = (pack.points || []).filter((p) => !gone.has(p.id))
      persist({
        points: kept.concat(withConn),
        values: (pack.values || []).filter((v) => !gone.has(v.pointId || v.key)),
        version: 3,
      })
    } else {
      const points = (pack.points || []).slice()
      for (const np of withConn) {
        const idx = points.findIndex(
          (p) =>
            (p.connectionId || p.connId) === fixedCid &&
            (p.deviceId || '') === fixedDid &&
            p.function === np.function &&
            p.address === np.address,
        )
        if (idx >= 0) points[idx] = { ...points[idx], ...np, id: points[idx].id }
        else points.push(np)
      }
      persist({ points, version: 3 })
    }
  }

  return {
    generateBatch,
    removePointRow,
    enterDeviceEdit,
    enterPointsEdit,
    patchDraft,
    applyPointFlagLocal,
    validateAlarmEnable,
    persistPointFlags,
    addNewPointRow,
    saveNewPointDraft,
    saveDeviceEdit,
    savePointsEdit,
    cancelDeviceEdit,
    cancelPointsEdit,
    exportCsv,
    importCsv,
    pointsOfDevice,
  }
}
