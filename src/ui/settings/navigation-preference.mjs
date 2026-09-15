export const PRESERVE_NAV_STORAGE_KEY = 'dsh-vision-bench:preserve-nav:enabled'

export function getPreserveNavPreference() {
  if (typeof window === 'undefined' || !window.localStorage) return false
  try {
    return window.localStorage.getItem(PRESERVE_NAV_STORAGE_KEY) === 'true'
  } catch {
    return false
  }
}

export function setPreserveNavPreference(enabled) {
  if (typeof window === 'undefined' || !window.localStorage) return
  try {
    window.localStorage.setItem(PRESERVE_NAV_STORAGE_KEY, enabled ? 'true' : 'false')
  } catch {}
}
