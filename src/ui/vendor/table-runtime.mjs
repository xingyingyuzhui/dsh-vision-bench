import { getVendor } from '../../../bench-vendor.mjs'

let override = null

/** Tests inject table-core; production reads DvbVendor. Never import React here. */
export function setTableRuntime(next) {
  override = next || null
}

export function getTableRuntime() {
  if (override && typeof override.createTable === 'function') return override
  const v = getVendor()
  if (v && typeof v.createTable === 'function' && typeof v.getCoreRowModel === 'function') {
    return {
      createTable: v.createTable,
      getCoreRowModel: v.getCoreRowModel,
      getSortedRowModel: v.getSortedRowModel,
    }
  }
  return null
}
