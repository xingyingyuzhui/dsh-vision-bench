// Build-time shim for @tanstack/react-virtual's only react-dom import:
// `flushSync` is used to force a synchronous re-render after measure events.
// Aliasing here avoids `require('react-dom')` inside the plugin factory (the
// harness require only resolves 'react'). Direct call preserves semantics.
export const flushSync = (fn) => fn()
export const version = '0.0.0-shim'
export default { flushSync }