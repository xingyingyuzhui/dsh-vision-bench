import { renderDeviceForm } from './device-form.mjs'

/** Device create/edit form used by the HMI page. */
export function renderDeviceEditor(el, t, ctx) {
  return renderDeviceForm(el, t, ctx)
}
