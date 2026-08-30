// @ts-check
/** @param {any} raw @param {{ min?: number, max?: number }} [opts] */
export const clampUnitId = (raw, { min = 0, max = 247 } = {}) => {
  const n = Math.trunc(Number(raw))
  if (!Number.isFinite(n)) return null
  if (n < min || n > max) return null
  return n
}

/** @param {any} pack */
export const stampPoints = (pack) =>
  (pack.points || []).map((/** @type {any} */ p) => {
    const dev = (pack.devices || []).find((/** @type {any} */ d) => d.id === p.deviceId)
    return { ...p, unitId: Math.min(247, Math.max(1, Math.trunc(Number(dev?.unitId) || 1))) }
  })
