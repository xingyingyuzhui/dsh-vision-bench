import assert from 'node:assert/strict'
import test from 'node:test'
import {
  createVisionFetchDispatchHandler,
  registerVisionFetchDispatch,
} from '../../src/interfaces/fetch/vision-fetch-route.mjs'
import { createVisionFetchPost } from '../../src/infrastructure/host/vision-rpc-client.mjs'
import { VISION_FETCH_DISPATCH_PATH } from '../../src/shared/vision-rpc-contract.mjs'

test('createVisionFetchPost posts endpoint whitelist to dispatch path', async () => {
  /** @type {Array<{ url: string, init?: RequestInit }>} */
  const calls = []
  const post = createVisionFetchPost(async (url, init) => {
    calls.push({ url: String(url), init })
    return Response.json({ ok: true, value: { ok: true, via: 'fetch' } })
  })
  const data = await post('/dsh-vision-bench/state', { cwd: '/tmp' }, 3000)
  assert.equal(data.ok, true)
  assert.equal(data.via, 'fetch')
  assert.equal(calls[0].url, VISION_FETCH_DISPATCH_PATH)
  const body = JSON.parse(String(calls[0].init?.body || '{}'))
  assert.deepEqual(body, { endpoint: 'state', payload: { cwd: '/tmp' } })
})

test('Fetch dispatch rejects unknown endpoint and forwards AbortSignal', async () => {
  const handler = createVisionFetchDispatchHandler({
    async dispatch(endpoint, payload, signal) {
      if (signal?.aborted) throw new DOMException('aborted', 'AbortError')
      return { ok: true, endpoint, payload }
    },
  })
  const bad = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'nope' }),
    }),
  )
  assert.equal(bad.status, 400)

  const ac = new AbortController()
  ac.abort()
  const cancelled = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
      signal: ac.signal,
    }),
  )
  const cancelledBody = await cancelled.json()
  assert.equal(cancelledBody.ok, false)
  assert.equal(cancelledBody.error.code, 'cancelled')
})

test('registerVisionFetchDispatch requires connection.fetch.register', () => {
  assert.throws(
    () => registerVisionFetchDispatch({}, { dispatch: async () => ({}) }),
    /fetch\.register/,
  )
})
