// Vendor bridge — reads the `DvbVendor` factory-scope var injected by
// scripts/build-client.mjs (which contains esbuild-bundled uPlot + virtual-core
// + table-core, incl. the official @tanstack/react-virtual adapter).
//
// IMPORTANT: lookups are LAZY (functions, not module-load-time consts) because
// `DvbVendor` only exists after the ModuleLoader factory runs (in the bundled
// client) — and source-level tests install globalThis.DvbVendor late, after the
// module graph finished importing. Consumers must call these at render/effect
// time, never at module top level.

export const getVendor = () => (typeof DvbVendor !== 'undefined' && DvbVendor) || null

export const vendorUPlot = () => {
  const v = getVendor()
  return (v && v.uPlot) || null
}

export const vendorVirtualizer = () => {
  const v = getVendor()
  return (v && v.Virtualizer) || null
}

export const vendorElementScroll = () => {
  const v = getVendor()
  return (v && v.elementScroll) || null
}

// Task2/0.18.2: official React adapter — its internal `require('react')`
// resolves to the harness React inside the ModuleLoader factory scope.
export const vendorUseVirtualizer = () => {
  const v = getVendor()
  return (v && v.useVirtualizer) || null
}

export const vendorCreateTable = () => {
  const v = getVendor()
  return (v && v.createTable) || null
}

export const vendorGetCoreRowModel = () => {
  const v = getVendor()
  return (v && v.getCoreRowModel) || null
}

export const vendorGetSortedRowModel = () => {
  const v = getVendor()
  return (v && v.getSortedRowModel) || null
}

export const vendorAvailable = () => !!(vendorUPlot() && vendorVirtualizer())
