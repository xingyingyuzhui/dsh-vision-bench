// Vendor bridge — reads the `DvbVendor` factory-scope var injected by
// scripts/build-client.mjs (which contains esbuild-bundled uPlot + virtual-core).
// Consumers import { vendorUPlot, vendorVirtualizer } from './bench-vendor.mjs'.
// strip-concat drops the import, keeps these const declarations.

const _vendor = (typeof DvbVendor !== 'undefined' && DvbVendor) || null

export const vendorUPlot = (_vendor && _vendor.uPlot) || null
export const vendorVirtualizer = (_vendor && _vendor.Virtualizer) || null
export const vendorElementScroll = (_vendor && _vendor.elementScroll) || null
export const vendorAvailable = !!(vendorUPlot && vendorVirtualizer)
