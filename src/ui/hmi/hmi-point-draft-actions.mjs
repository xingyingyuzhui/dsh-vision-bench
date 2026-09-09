import { AREA_BY_FN_EDIT, hmiGenId } from './hmi-ids.mjs'

/**
 * Point and device editing drafts actions.
 * @param {any} ctx
 * @param {any} core
 */
export function createHmiPointDraftActions(ctx, core) {
  const {
    t,
    setError,
    editingPointsDeviceId,
    setEditingPointsDeviceId,
    setEditingDeviceId,
    deviceDraft,
    setDeviceDraft,
    pointDraftsById,
    setPointDraftsById,
    newPointDraft,
    setNewPointDraft,
    setInlineWrite,
    setBatch,
  } = ctx
  const { normalizePack, persist, activeConnIdOf } = core

  function pointsOfDevice(devId) {
    const packNow = normalizePack()
    const active = packNow.activeConnectionId || packNow.connections[0]?.id || ''
    return (packNow.points || []).filter((p) => (p.connectionId || p.connId) === active && (p.deviceId || '') === devId)
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

  function addNewPointRow(deviceId) {
    const pack = normalizePack()
    const activeConnId = activeConnIdOf()
    const dev = (pack.devices || []).find((x) => x.id === deviceId)
    const fixedCid = dev?.connectionId || activeConnId
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
            AREA_BY_FN_EDIT[fnNum] ||
            dr.area ||
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

  return {
    pointsOfDevice,
    removePointRow,
    enterDeviceEdit,
    enterPointsEdit,
    patchDraft,
    addNewPointRow,
    saveNewPointDraft,
    saveDeviceEdit,
    savePointsEdit,
    cancelDeviceEdit,
    cancelPointsEdit,
  }
}
