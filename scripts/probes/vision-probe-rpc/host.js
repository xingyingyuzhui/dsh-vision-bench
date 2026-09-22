/**
 * Phase-0 probe B — rpc.handle control group.
 * Current DSH Host wires rpc.handle through owner.webServer.register.
 * On Desktop without webServer, register must fail without blocking Host boot
 * (soft-fail; scheme A / fetch.register remains the Desktop path).
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
    // Soft-fail: Desktop must keep Host alive; failure is the B/scheme-B datapoint.
    console.info(
      JSON.stringify({
        event: 'vision.probe.rpc.apply_failed',
        channel: CHANNEL,
        pid,
        message,
        at: Date.now(),
      }),
    )
  }
}
