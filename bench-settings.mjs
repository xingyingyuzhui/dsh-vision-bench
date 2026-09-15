// Compatibility facade — prefer src/ui/settings/*.
export {
  PRESERVE_NAV_STORAGE_KEY,
  getPreserveNavPreference,
  setPreserveNavPreference,
} from './src/ui/settings/navigation-preference.mjs'
export { statusKind, pluginVersionLabel, ioStatusInfo } from './src/ui/settings/tool-status.mjs'
export { createSettingsPage } from './src/ui/settings/settings-page.mjs'
export { registerSettings } from './src/ui/settings/register-settings.mjs'
