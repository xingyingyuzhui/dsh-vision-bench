import { renderDeviceCards } from './device-card.mjs'

/** Device cards + nested point tables for the active connection. */
export function renderDeviceSection(el, t, ctx) {
  return renderDeviceCards(el, t, ctx)
}
