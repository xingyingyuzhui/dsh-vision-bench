import { VISION_GUIDANCE } from './bench-guidance.mjs'
import { visionBenchTool } from './bench-tool.mjs'
import { defaultDshHome } from './src/infrastructure/store/dsh-home.mjs'
import { visionDebugTool } from './src/interfaces/agent/vision-debug-tool.mjs'

/** Agent-plane loader. Dirty key must not equal the host plugin name. */
export const name = 'dsh-vision-bench-tools'
export const inject = ['tools', 'systemPrompt']

export function apply(ctx) {
  const home = defaultDshHome()
  if (!ctx?.tools || typeof ctx.tools.register !== 'function') {
    throw new Error('dsh-vision-bench-tools: Agent requires ctx.tools.register')
  }
  if (!ctx.systemPrompt || typeof ctx.systemPrompt.section !== 'function') {
    throw new Error('dsh-vision-bench-tools: Agent requires ctx.systemPrompt.section')
  }
  ctx.effect(() => ctx.tools.register(visionBenchTool(home)), 'vision-bench.tools.vision_bench')
  ctx.effect(() => ctx.tools.register(visionDebugTool(home)), 'vision-bench.tools.vision_debug')
  ctx.effect(
    () =>
      ctx.systemPrompt.section({
        name: 'vision-bench:guidance',
        order: 20,
        text: () => VISION_GUIDANCE,
      }),
    'vision-bench.guidance',
  )
}
