import { csvToPoints, pointsToCsv } from '../../../bench-points.mjs'
import { hmiGenId } from './hmi-ids.mjs'

/**
 * CSV import and export actions for HMI points.
 * @param {any} ctx
 * @param {any} core
 */
export function createHmiPointCsvActions(ctx, core) {
  const { t, setError, csvText, setCsvText, csvTarget, setCsvTarget, setCsvNote } = ctx
  const { normalizePack, persist } = core

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

  return { exportCsv, importCsv }
}
