// @ts-check

/** @param {any} value */
export const finiteOrNull = (value) => {
  if (value === null || value === undefined || value === '') return null
  const n = Number(value)
  return Number.isFinite(n) ? n : null
}

/**
 * Alarm hysteresis in engineering units.
 * Blank stays null so evaluation uses |threshold| × DEFAULT_ALARM_DEADBAND_RATIO.
 * Explicit 0 is preserved (no hysteresis). Negative and non-finite values are rejected.
 * @param {any} value
 * @returns {{ ok: true, value: number | null } | { ok: false }}
 */
export const parseAlarmDeadband = (value) => {
  if (value === null || value === undefined || value === '') return { ok: true, value: null }
  const n = Number(value)
  if (!Number.isFinite(n) || n < 0) return { ok: false }
  return { ok: true, value: n }
}

/** Invalid values become null; explicit 0 is kept. @param {any} value @returns {number | null} */
export const coercedAlarmDeadband = (value) => {
  const parsed = parseAlarmDeadband(value)
  return parsed.ok ? parsed.value : null
}
