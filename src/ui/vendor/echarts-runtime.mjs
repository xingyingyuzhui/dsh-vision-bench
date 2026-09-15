import { getVendor } from './vendor-bridge.mjs'

let override = null

export function setEchartsRuntime(next) {
  override = next || null
}

export function getEcharts() {
  if (override) return override
  const v = getVendor()
  return v?.echarts || null
}
