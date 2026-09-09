import { AREA_BY_FN_EDIT, hmiGenId } from './hmi-ids.mjs'

/**
 * Batch generation actions for HMI points.
 * @param {any} ctx
 * @param {any} core
 * @param {{ pointsOfDevice: (deviceId: string) => any[] }} deps
 */
export function createHmiPointBatchActions(ctx, core, deps) {
  const {
    setError,
    batch,
    setBatch,
    pointDraftsById,
    setPointDraftsById,
    editingPointsDeviceId,
    setEditingPointsDeviceId,
    setEditingDeviceId,
    setDeviceDraft,
  } = ctx
  const { normalizePack } = core
  const { pointsOfDevice } = deps

  function generateBatch() {
    const pack = normalizePack()
    const fixedCid = batch.connectionId || pack.activeConnectionId || pack.connections[0]?.id || ''
    const fixedDid = batch.deviceId
    if (!fixedDid) {
      setError('请先选择设备')
      return
    }
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
    const existingIds = new Set([...(pack.points || []).map((p) => p.id), ...Object.keys(currentDrafts)])
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

  return { generateBatch }
}
