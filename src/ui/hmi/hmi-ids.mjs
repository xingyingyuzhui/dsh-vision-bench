import { functionCodeOf } from '../../../bench-points.mjs'

export const POLL_INTERVALS = [500, 1000, 2000, 5000]

export function fnOptionLabel(t, fn) {
  void t
  return functionCodeOf(fn)
}

export const AREA_BY_FN_EDIT = { 1: 'coil', 2: 'discreteInput', 3: 'holdingRegister', 4: 'inputRegister' }

export function hmiGenId(prefix) {
  return prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6)
}
