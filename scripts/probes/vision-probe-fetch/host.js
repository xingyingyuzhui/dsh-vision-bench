/**
 * Phase-0 probe A — Connection exact Fetch route.
 * inject=['connection'] only; no webServer, no Vision state, no hardware.
 */
export const name = '@dsh-vision/probe-fetch'
export const inject = ['connection']

const PATH = '/api/vision-probe'
const STARTED_AT = Date.now()

export function apply(ctx) {
  const pid = process.pid
  const dshHint = process.env.DSH_VISION_PROBE_TAG || 'unset'

  ctx.connection.fetch.register({
    path: PATH,
    methods: ['POST', 'GET'],
    requestBody: 'buffered',
    fetch: async (request) => {
      const url = new URL(request.url)
      let body = null
      if (request.method === 'POST') {
        try {
          body = await request.json()
        } catch {
          return Response.json({ ok: false, error: 'INVALID_JSON' }, { status: 400 })
        }
      }
      return Response.json({
        ok: true,
        probe: 'fetch',
        path: url.pathname,
        method: request.method,
        pid,
        startedAt: STARTED_AT,
        dshHint,
        echo: body,
      })
    },
  })

  // Registration is owned by the calling fiber via owner.effect in DSH;
  // no second dispose layer. Log once for lifecycle correlation.
  console.info(
    JSON.stringify({
      event: 'vision.probe.fetch.start',
      path: PATH,
      pid,
      dshHint,
      at: STARTED_AT,
    }),
  )
}
