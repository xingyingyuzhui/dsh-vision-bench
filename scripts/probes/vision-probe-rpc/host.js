/**
 * Phase-0 probe B — rpc.handle control group.
 * Current DSH Host wires rpc.handle through owner.webServer.register.
 * Desktop without webServer is expected to fail at apply — that failure is data for B1/方案对比.
 */
export const name = '@dsh-vision/probe-rpc'
export const inject = ['connection']

const CHANNEL = '/vision-probe'

export function apply(ctx) {
  const pid = process.pid
  try {
    ctx.connection.rpc.handle(CHANNEL, async () => ({
      ok: true,
      probe: 'rpc',
      channel: CHANNEL,
      pid,
    }))
    console.info(
      JSON.stringify({
        event: 'vision.probe.rpc.start',
        channel: CHANNEL,
        pid,
        at: Date.now(),
      }),
    )
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err)
    console.error(
      JSON.stringify({
        event: 'vision.probe.rpc.apply_failed',
        channel: CHANNEL,
        pid,
        message,
        at: Date.now(),
      }),
    )
    throw err
  }
}
