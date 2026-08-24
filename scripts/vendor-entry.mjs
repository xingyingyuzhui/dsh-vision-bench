// Build-time vendor entry: bundles uPlot + @tanstack/virtual-core into the
// plugin client (Task 1 / 0.18.1). Never pollutes window; DvbVendor is injected
// into the ModuleLoader factory scope by scripts/build-client.mjs.
import uPlot from 'uplot'
import { Virtualizer, elementScroll, observeElementRect, observeElementOffset } from '@tanstack/virtual-core'

export { uPlot, Virtualizer, elementScroll, observeElementRect, observeElementOffset }
