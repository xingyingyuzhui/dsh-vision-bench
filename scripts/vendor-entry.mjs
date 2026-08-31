import { useVirtualizer } from '@tanstack/react-virtual'
import { createTable, getCoreRowModel, getSortedRowModel } from '@tanstack/table-core'
import { Virtualizer, elementScroll, observeElementOffset, observeElementRect } from '@tanstack/virtual-core'
// Build-time vendor entry: bundles uPlot + TanStack virtualizers/table-core into
// the plugin client. Never pollutes window; DvbVendor is injected into the
// ModuleLoader factory scope by scripts/build-client.mjs.
// react/react-dom are EXTERNAL: the harness React is used via require('react')
// inside the factory (no second React copy). Do not import useReactTable —
// that hook binds node_modules React and would break harness/stub mounts.
import uPlot from 'uplot'

export {
  uPlot,
  Virtualizer,
  elementScroll,
  observeElementRect,
  observeElementOffset,
  useVirtualizer,
  createTable,
  getCoreRowModel,
  getSortedRowModel,
}
