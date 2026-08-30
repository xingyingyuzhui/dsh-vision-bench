import { renderConnectionForm } from './connection-form.mjs'

/** Connection create/edit form used by the HMI page. */
export function renderConnectionEditor(el, t, ctx) {
  return renderConnectionForm(el, t, ctx)
}
