import { getVendor } from './vendor-bridge.mjs'

let override = null

export function setGridRuntime(next) {
  override = next || null
}

export function getGridStack() {
  if (override) return override
  const v = getVendor()
  return v?.GridStack || null
}
