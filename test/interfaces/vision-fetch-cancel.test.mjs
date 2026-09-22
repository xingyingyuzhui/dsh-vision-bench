import assert from 'node:assert/strict'
import test from 'node:test'
import { createVisionFetchDispatchHandler } from '../../src/interfaces/fetch/vision-fetch-route.mjs'
import { createVisionFetchPost } from '../../src/infrastructure/host/vision-rpc-client.mjs'
import { apply } from '../../host.js'
import { VISION_FETCH_DISPATCH_PATH } from '../../src/shared/vision-rpc-contract.mjs'
import { createHostContext, mockRpcHost } from '../helpers/rpc-factory.mjs'

test('Fetch dispatch forwards request.signal into debug/events/wait and unblocks on abort', async () => {
  /** @type {AbortSignal | undefined} */
  let seenSignal
  const router = {
    async dispatch(endpoint, _payload, signal) {
      assert.equal(endpoint, 'debug/events/wait')
      seenSignal = signal
      return await new Promise((resolve) => {
        const finish = () => resolve({ ok: true, events: [], nextCursor: 0, closed: false })
        if (!signal) {
          finish()
          return
        }
        if (signal.aborted) {
          finish()
          return
        }
        signal.addEventListener('abort', finish, { once: true })
      })
    },
  }
  const handler = createVisionFetchDispatchHandler(router)
  const ac = new AbortController()
  const started = Date.now()
  const pending = handler(
    new Request(`http://host${VISION_FETCH_DISPATCH_PATH}`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        endpoint: 'debug/events/wait',
        payload: { cwd: '/tmp', sessionId: 's-cancel', cursor: 0, timeoutMs: 20000 },
      }),
      signal: ac.signal,
    }),
  )
  setTimeout(() => ac.abort(), 25)
  const res = await pending
  const elapsedMs = Date.now() - started
  assert.ok(seenSignal, 'router must receive request.signal')
  assert.equal(seenSignal.aborted, true)
  assert.ok(elapsedMs < 2000, `abort must unblock wait (took ${elapsedMs}ms)`)
  const body = await res.json()
  // Debug wait soft-resolves empty on abort; transport ok with business value.
  assert.equal(body.ok, true)
  assert.equal(body.value?.ok, true)
  assert.deepEqual(body.value?.events, [])
})

test('createVisionFetchPost rejects when caller aborts before settle', async () => {
  const ac = new AbortController()
  const post = createVisionFetchPost(async (_url, init) => {
    assert.ok(init?.signal)
    return await new Promise((_resolve, reject) => {
      init.signal.addEventListener(
        'abort',
        () => reject(Object.assign(new Error('aborted'), { name: 'AbortError' })),
        { once: true },
      )
    })
  })
  const pending = post('/dsh-vision-bench/debug/events/wait', { cursor: 0 }, { signal: ac.signal, timeoutMs: 20000 })
  queueMicrotask(() => ac.abort())
  await assert.rejects(pending, /aborted|AbortError|vision fetch/i)
})

test('Host apply without webServer still registers Fetch dispatch (Desktop path)', async () => {
  const connection = mockRpcHost()
  const { ctx, routes, stop } = createHostContext(connection)
  delete ctx.webServer
  ctx.inject = () => {
    /* Cordis: missing webServer → no-op */
  }
  apply(ctx)
  assert.equal(routes.length, 0, 'no HTTP command bridge without webServer')
  assert.equal(connection.hasFetchHandler, true)
  assert.equal(connection.hasHandler, false, 'legacy RPC stays Web-only')
  const res = await connection.invokeFetch('state', {})
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.value?.ok, true)
  await stop()
})
