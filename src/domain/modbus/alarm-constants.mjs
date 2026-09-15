// @ts-check
// Domain alarm constants and shared helpers.

export const ACTIVE = 'active'
export const RECOVERED = 'recovered'
export const ACKED = 'acked'
export const ALARM_STATUS = { ACTIVE, RECOVERED, ACKED }

export const PROCESS = 'process'
export const COMM = 'comm'
export const ALARM_GROUP = { PROCESS, COMM }

export const COND_ACTIVE = 'active'
export const COND_RECOVERED = 'recovered'
export const ALARM_CONDITION = { ACTIVE: COND_ACTIVE, RECOVERED: COND_RECOVERED }

export const ALLOWED_STATUS = new Set([ACTIVE, RECOVERED, ACKED])
export const ALLOWED_GROUP = new Set([PROCESS, COMM])
export const ALLOWED_COND = new Set([COND_ACTIVE, COND_RECOVERED])

/** @param {any} v */
export const textBy = (v) => (typeof v === 'string' ? v.trim().slice(0, 32) : '')

export const nowMs = () => Date.now()
export const capAlarm = 256
export const defaultSuppressMs = 30_000

/** @param {any} v */
export const textId = (v) => (typeof v === 'string' ? v.trim() : '')
