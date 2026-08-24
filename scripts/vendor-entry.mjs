// Build-time vendor entry: bundles uPlot + TanStack virtualizers into the
// plugin client (Task1 + Task2/0.18.2). Never pollutes window; DvbVendor is
// injected into the ModuleLoader factory scope by scripts/build-client.mjs.
// react/react-dom are EXTERNAL: the harness React is used via require('react')
// inside the factory (no second React copy).
import uPlot from 'uplot'
import { Virtualizer, elementScroll, observeElementRect, observeElementOffset } from '@tanstack/virtual-core'
import { useVirtualizer } from '@tanstack/react-virtual'

export { uPlot, Virtualizer, elementScroll, observeElementRect, observeElementOffset, useVirtualizer }