import { csvToPoints, pointsToCsv } from '../../../bench-points.mjs'
import { AREA_BY_FN_EDIT, hmiGenId } from './hmi-ids.mjs'

/** Point table, flags, drafts, and CSV actions. */
export function createHmiPointActions(ctx, core) {
  const {
    t,
    post,
    cwd,
    sessionId,
    commandClient,
    setError,
    setWorkspace,
    workspaceRef,
    flagInflight,
    editingDeviceId,
    setEditingDeviceId,
    editingPointsDeviceId,
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
    const d = (pack.devices || []).find((x) => x.id === fixedDid)
    let currentDrafts = pointDraftsById
    if (editingPointsDeviceId !== fixedDid) {
      setError('')
      setEditingDeviceId('')
      setDeviceDraft(null)
      setEditingPointsDeviceId(fixedDid)
      currentDrafts = {}
      for (const pt of pointsOfDevice(fixedDid)) {
        currentDrafts[pt.id] = {
          id: pt.id,
          connectionId: pt.connectionId,
          connId: pt.connId || pt.connectionId,
          deviceId: pt.deviceId,
          name: pt.name || '',
          function: pt.function,
          area: pt.area || AREA_BY_FN_EDIT[pt.function] || 'holdingRegister',
          address: pt.address,
          scale: pt.scale,
          offset: pt.offset,
          unit: pt.unit || '',
          monitorEnabled: pt.monitorEnabled === true,
          alarmEnabled: pt.alarmEnabled === true,
          alarmMin: pt.alarmMin == null ? '' : String(pt.alarmMin),
          alarmMax: pt.alarmMax == null ? '' : String(pt.alarmMax),
          trendEnabled: pt.trendEnabled === true,
        }
      }
    }
    const count = Math.max(1, Math.min(Number(batch.count) || 1, 64))
    const existingIds = new Set([
      ...(pack.points || []).map((p) => p.id),
      ...Object.keys(currentDrafts),
    ])
    const existingAddr = new Set(
      Object.values(currentDrafts)
        .filter((p) => Number(p.function) === Number(batch.fc))
        .map((p) => Number(p.address)),
    )
    const additions = []
    for (let i = 0; i < count; i++) {
      const address = Number(batch.start) + i
      if (existingAddr.has(address)) continue
      const id = hmiGenId('p')
      if (existingIds.has(id)) continue
      existingIds.add(id)
      existingAddr.add(address)
      additions.push({
        id,
        isNew: true,
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
        monitorEnabled: false,
        alarmEnabled: false,
        alarmMin: '',
        alarmMax: '',
        trendEnabled: false,
      })
    }
    if (!additions.length) {
      setError('批量点位的地址全部与现有点位重复')
      return
    }
    setError('')
    const nextDrafts = { ...currentDrafts }
    for (const item of additions) {
      nextDrafts[item.id] = item
    }
    setPointDraftsById(nextDrafts)
    setBatch((prev) => ({ ...prev, open: false }))
  }

  function removePointRow(point) {
    if (editingPointsDeviceId && editingPointsDeviceId === point.deviceId) {
      setPointDraftsById((prev) => {
        const next = { ...prev }
        delete next[point.id]
        return next
      })
      return
    }
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
          const defaultTip = keys[0] === 'monitorEnabled' ? '监视状态保存失败，已恢复原状态' : '告警状态保存失败，已恢复原状态'
          const tip = data?.error
            ? `${keys[0] === 'monitorEnabled' ? '监视' : '告警'}状态保存失败（${data.error}），已恢复原状态`
            : defaultTip
          return recoverFromFailure(tip).then(() => data)
        }
        return applySuccess(data)
      })
      .catch((err) => {
        const errMsg = err && err.message ? `（${err.message}）` : ''
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

  function addNewPointRow(deviceId) {
    const pack = normalizePack()
    const activeConnId = activeConnIdOf()
    const dev = (pack.devices || []).find((x) => x.id === deviceId)
    const fixedCid = (dev && dev.connectionId) || activeConnId
    setError('')
    setInlineWrite(null)
    setEditingDeviceId('')
    setDeviceDraft(null)
    setNewPointDraft(null)
    setBatch((prev) => ({ ...prev, open: false, deviceId, connectionId: fixedCid }))

    let currentDrafts = pointDraftsById
    if (editingPointsDeviceId !== deviceId) {
      setEditingPointsDeviceId(deviceId)
      currentDrafts = {}
      for (const pt of pointsOfDevice(deviceId)) {
        currentDrafts[pt.id] = {
          id: pt.id,
          connectionId: pt.connectionId,
          connId: pt.connId || pt.connectionId,
          deviceId: pt.deviceId,
          name: pt.name || '',
          function: pt.function,
          area: pt.area || AREA_BY_FN_EDIT[pt.function] || 'holdingRegister',
          address: pt.address,
          scale: pt.scale,
          offset: pt.offset,
          unit: pt.unit || '',
          monitorEnabled: pt.monitorEnabled === true,
          alarmEnabled: pt.alarmEnabled === true,
          alarmMin: pt.alarmMin == null ? '' : String(pt.alarmMin),
          alarmMax: pt.alarmMax == null ? '' : String(pt.alarmMax),
          trendEnabled: pt.trendEnabled === true,
        }
      }
    }

    let maxAddr = -1
    for (const p of Object.values(currentDrafts)) {
      const a = Number(p.address)
      if (Number.isFinite(a) && a > maxAddr) maxAddr = a
    }
    const nextAddr = maxAddr >= 0 ? maxAddr + 1 : 0
    const id = hmiGenId('p')
    const newDraft = {
      id,
      isNew: true,
      connectionId: fixedCid,
      connId: fixedCid,
      deviceId,
      name: '',
      function: 3,
      area: 'holdingRegister',
      address: nextAddr <= 65535 ? nextAddr : 0,
      scale: 1,
      offset: 0,
      unit: '',
      monitorEnabled: true,
      alarmEnabled: false,
      alarmMin: '',
      alarmMax: '',
      trendEnabled: true,
    }
    setPointDraftsById({ ...currentDrafts, [id]: newDraft })
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
    const draftList = Object.values(drafts)
    const seen = new Map()

    for (const dr of draftList) {
      const addrNum = Math.trunc(Number(dr.address))
      if (!Number.isFinite(addrNum) || addrNum < 0 || addrNum > 65535) {
        setError((t('ptAddr') || '地址') + ' 0–65535')
        return
      }
      const fnNum = Math.trunc(Number(dr.function) || 3)
      if (![1, 2, 3, 4].includes(fnNum)) {
        setError('非法功能码')
        return
      }
      const key = (dr.connectionId || d.connectionId || '') + '|' + d.id + '|' + fnNum + '|' + addrNum
      if (seen.has(key)) {
        setError('该设备下已存在相同功能码和地址的点位')
        return
      }
      seen.set(key, dr)

      const min = dr.alarmMin !== '' && dr.alarmMin != null ? Number(dr.alarmMin) : null
      const max = dr.alarmMax !== '' && dr.alarmMax != null ? Number(dr.alarmMax) : null
      if (dr.alarmEnabled === true && min != null && max != null && !(min < max)) {
        setError('下限必须小于上限: ' + (dr.name || '点位'))
        return
      }
    }

    try {
      const fixedCid = d.connectionId || pack.activeConnectionId || pack.connections[0]?.id || ''
      const otherPoints = (pack.points || []).filter((p) => (p.deviceId || '') !== d.id)
      const thisDevicePoints = draftList.map((dr) => {
        const fnNum = Math.trunc(Number(dr.function) || 3)
        const addrNum = Math.trunc(Number(dr.address))
        const min = dr.alarmMin !== '' && dr.alarmMin != null ? Number(dr.alarmMin) : null
        const max = dr.alarmMax !== '' && dr.alarmMax != null ? Number(dr.alarmMax) : null
        const alarmOn = dr.alarmEnabled === true
        const monitorOn = dr.monitorEnabled === true
        return {
          id: dr.id || hmiGenId('p'),
          connectionId: dr.connectionId || fixedCid,
          connId: dr.connId || dr.connectionId || fixedCid,
          deviceId: d.id,
          name: String(dr.name || '').slice(0, 40),
          function: fnNum,
          area:
            dr.area ||
            AREA_BY_FN_EDIT[fnNum] ||
            (fnNum === 1 ? 'coil' : fnNum === 2 ? 'discreteInput' : fnNum === 4 ? 'inputRegister' : 'holdingRegister'),
          address: addrNum,
          scale: Number(dr.scale) || 1,
          offset: Number(dr.offset) || 0,
          unit: String(dr.unit || '').slice(0, 12),
          monitorEnabled: monitorOn,
          alarmEnabled: alarmOn,
          alarmMin: Number.isFinite(min) ? min : null,
          alarmMax: Number.isFinite(max) ? max : null,
          trendEnabled: dr.trendEnabled !== undefined ? dr.trendEnabled === true : monitorOn,
        }
      })

      setError('')
      setEditingPointsDeviceId('')
      setPointDraftsById({})
      setNewPointDraft(null)
      setBatch((prev) => ({ ...prev, open: false }))
      persist({ points: otherPoints.concat(thisDevicePoints), version: 3 })
    } catch (err) {
      setError(String(err?.message || err))
    }
  }

  function cancelDeviceEdit() {
    setEditingDeviceId('')
    setDeviceDraft(null)
  }

  function cancelPointsEdit() {
    setError('')
    setEditingPointsDeviceId('')
    setPointDraftsById({})
    setNewPointDraft(null)
    setBatch((prev) => ({ ...prev, open: false }))
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
