const REACT_PORTAL_TYPE = Symbol.for('react.portal')

function bodyNode() {
  return typeof document !== 'undefined' ? document.body : null
}

/**
 * Lift a dialog tree onto document.body so official conversation
 * `container-type` + sticky composer (z-index 7) cannot cover it.
 * Uses the React portal protocol; no react-dom import.
 *
 * @param {any} node
 * @returns {any}
 */
export function toBodyPortal(node) {
  if (!node) return null
  const body = bodyNode()
  if (!body) return node
  return {
    $$typeof: REACT_PORTAL_TYPE,
    key: null,
    children: node,
    containerInfo: body,
    implementation: null,
  }
}

/**
 * @param {any} node
 * @returns {any}
 */
export function portalChildren(node) {
  return node && node.$$typeof === REACT_PORTAL_TYPE ? node.children : node
}
