export { TAB_MAP, createMapView, getTargetJump, setTargetJump } from './src/ui/debug/project/project-page.mjs'

export function registerMap(ctx, React, t, MapPage) {
  const bs = ctx.betterSidebar
  return bs.registerTab({
    id: 'dsh-vision-bench:project',
    title() {
      return t('projectMap')
    },
    single: true,
    order: 74,
    component: MapPage,
  })
}

export function openProjectTab(side) {
  if (side && typeof side.openTab === 'function') side.openTab({ type: 'dsh-vision-bench:project' })
}
