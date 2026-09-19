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

test('createVisionFetchPost uses nullish coalescing for missing payload', async () => {
  /** @type {unknown} */
  let sent
  const post = createVisionFetchPost(async (_url, init) => {
    sent = JSON.parse(String(init?.body || '{}'))
    return Response.json({ ok: true, value: { ok: true } })
  })
  await post('/dsh-vision-bench/state', undefined)
  assert.deepEqual(sent, { endpoint: 'state', payload: {} })
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

test('Fetch dispatch accepts large JSON bodies (no local 64KiB cap)', async () => {
  /** @type {unknown} */
  let seenPayload = null
  const handler = createVisionFetchDispatchHandler({
    async dispatch(_endpoint, payload) {
      seenPayload = payload
      return { ok: true }
    },
  })
  const blob = '中'.repeat(40_000)
  assert.ok(Buffer.byteLength(JSON.stringify({ endpoint: 'state', payload: { blob } }), 'utf8') > 65536)
  const res = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: { blob } }),
    }),
  )
  assert.equal(res.status, 200)
  assert.equal(typeof seenPayload?.blob, 'string')
  assert.equal(seenPayload.blob.length, 40_000)
})

test('Fetch dispatch rejects non-object payload with 400', async () => {
  const handler = createVisionFetchDispatchHandler({
    async dispatch() {
      return { ok: true }
    },
  })
  const res = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: 'nope' }),
    }),
  )
  assert.equal(res.status, 400)
  const body = await res.json()
  assert.match(body.error.message, /payload must be a JSON object/)
})

test('Fetch dispatch missing payload defaults to empty object', async () => {
  /** @type {unknown} */
  let seen = null
  const handler = createVisionFetchDispatchHandler({
    async dispatch(_e, payload) {
      seen = payload
      return { ok: true }
    },
  })
  const res = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state' }),
    }),
  )
  assert.equal(res.status, 200)
  assert.deepEqual(seen, {})
})

test('Fetch dispatch returns business ok:false as transport success', async () => {
  const handler = createVisionFetchDispatchHandler({
    async dispatch() {
      return { ok: false, errorCode: 'CONFIG_DRIFT', error: '请刷新' }
    },
  })
  const res = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    }),
  )
  assert.equal(res.status, 200)
  const body = await res.json()
  assert.equal(body.ok, true)
  assert.equal(body.value.ok, false)
  assert.equal(body.value.errorCode, 'CONFIG_DRIFT')
})

test('Fetch dispatch returns 500 for unserializable router results', async () => {
  const cyclic = /** @type {any} */ ({})
  cyclic.self = cyclic
  const handler = createVisionFetchDispatchHandler({
    async dispatch() {
      return cyclic
    },
  })
  const res = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    }),
  )
  assert.equal(res.status, 500)
})

test('Fetch dispatch returns 500 for router exceptions', async () => {
  const handler = createVisionFetchDispatchHandler({
    async dispatch() {
      throw new Error('router boom')
    },
  })
  const res = await handler(
    new Request('http://host/api/vision-bench/dispatch', {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ endpoint: 'state', payload: {} }),
    }),
  )
  assert.equal(res.status, 500)
  const body = await res.json()
  assert.equal(body.error.code, 'internal')
})

test('registerVisionFetchDispatch requires connection.fetch.register', () => {
  assert.throws(
    () => registerVisionFetchDispatch({}, { dispatch: async () => ({}) }),
    /fetch\.register/,
  )
})
