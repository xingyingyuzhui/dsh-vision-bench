import { getVendor } from '../../../bench-vendor.mjs'

let override = null

export function setCodeMirrorRuntime(next) {
  override = next || null
}

export function getCodeMirror() {
  if (override) return override
  const v = getVendor()
  return v?.codeMirror || null
}
