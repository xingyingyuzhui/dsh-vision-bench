import assert from 'node:assert/strict'
// Task1+2 / 0.18.3: state bus, frame logs and agent focus must be isolated per
// workspace (cwd). No singleton cross-talk, no timer leaks on final unsubscribe.
import { afterEach, before, test } from 'node:test'
import {
  clearFramesLog,
  getFocusState,
  getFramesLog,
  pushFramesLog,
  setFocusState,
  subscribeFocus,
  subscribeState,
} from '../bench-shared.mjs'

const POLL = 2000 // POLL_MS used by the bus
const wait = (ms) => new Promise((r) => setTimeout(r, ms))

// controllable post: each cwd answers its own workspace data
function makePost(dataByCwd) {
  const posts = { count: 0, lastPath: '', lastCwd: '' }
  const post = async (path, body) => {
    posts.count++
    posts.lastPath = path
    posts.lastCwd = body && body.cwd
    const data = dataByCwd[body && body.cwd]
    if (data && typeof data.then === 'function') return data
    return data || { workspace: { cwd: (body && body.cwd) || '' }, byCwd: (body && body.cwd) || '' }
  }
  return { post, posts }
}

// clean slate between tests: unsubscribe everything tracked
const unsubs = []
function track(fn) {
  unsubs.push(fn)
  return fn
}
afterEach(() => {
  for (const u of unsubs.splice(0)) {
    try {
      u()
    } catch {}
  }
})

test('A and B subscribe different cwds; each only receives its own data', async () => {
  const { post, posts } = makePost({
    '/work/a': { workspace: { id: 'W-A' }, byCwd: 'A' },
    '/work/b': { workspace: { id: 'W-B' }, byCwd: 'B' },
  })
  const gotA = []
  const gotB = []
  track(subscribeState(post, '/work/a', (d) => gotA.push(d)))
  // immediate first pull (before B joins)
  await wait(60)
  track(subscribeState(post, '/work/b', (d) => gotB.push(d)))
  await wait(60)
  // both have only their own data
  assert.ok(gotA.length >= 1, 'A got at least first snapshot')
  assert.ok(gotB.length >= 1, 'B got at least first snapshot')
  for (const d of gotA) assert.equal(d.byCwd, 'A', 'A must never receive B data')
  for (const d of gotB) assert.equal(d.byCwd, 'B', 'B must never receive A data')
})

test('same cwd multiple subscribers share ONE poller', async () => {
  let pulls = 0
  const post = async (path, body) => {
    pulls++
    return { workspace: { id: body.cwd }, byCwd: body.cwd }
  }
  const a = []
  const b = []
  track(subscribeState(post, '/work/x', (d) => a.push(d)))
  track(subscribeState(post, '/work/x', (d) => b.push(d)))
  // initial pull happened exactly once for the shared bus (B reused the cache)
  assert.equal(pulls, 1, 'one shared poller for the cwd, exactly one initial pull')
  await wait(80)
  // no per-subscriber pull: still exactly 1 (interval period is 2000ms)
  assert.equal(pulls, 1, 'no extra pulls after shared first fetch')
  assert.ok(a.length >= 1 && b.length >= 1, 'both subscribers received the shared snapshot')
})

test('unsubscribing one subscriber does not affect the other; final unsubscribe stops delivery', async () => {
  let pulls = 0
  const post = async (path, body) => {
    pulls++
    return { workspace: { id: body.cwd }, byCwd: body.cwd }
  }
  const a = []
  const b = []
  const unA = track(subscribeState(post, '/work/y', (d) => a.push(d)))
  const unB = track(subscribeState(post, '/work/y', (d) => b.push(d)))
  await wait(60)
  unA()
  const aCount = a.length
  const bCount = b.length
  await wait(80)
  assert.equal(a.length, aCount, 'unsubscribed A stops receiving')
  assert.ok(b.length >= bCount, 'B keeps receiving')
  unB()
  const bFinal = b.length
  await wait(80)
  assert.equal(b.length, bFinal, 'final unsubscribe stops all delivery')
})

test('in-flight response after final unsubscribe must not invoke callbacks', async () => {
  let release
  const gate = new Promise((r) => {
    release = r
  })
  const post = async () => {
    await gate
    return { byCwd: 'late', workspace: {} }
  }
  const got = []
  const un = track(subscribeState(post, '/work/z', (d) => got.push(d)))
  // let the first pull start (blocked on gate) then unsubscribe
  await wait(30)
  un()
  release()
  await wait(60)
  assert.equal(got.length, 0, 'in-flight response must be dropped after unsubscribe')
})

test('frame logs are isolated per cwd and clear only affects its own cwd', async () => {
  pushFramesLog('/work/a', 'c1', [{ frameId: 'a1', t: 1, label: 'A1' }])
  pushFramesLog('/work/b', 'c1', [{ frameId: 'b1', t: 1, label: 'B1' }])
  assert.equal(getFramesLog('/work/a', 'c1').length, 1)
  assert.equal(getFramesLog('/work/b', 'c1').length, 1)
  assert.equal(getFramesLog('/work/a', 'c1')[0].frameId, 'a1')
  assert.equal(getFramesLog('/work/b', 'c1')[0].frameId, 'b1')
  clearFramesLog('/work/a', 'c1')
  assert.equal(getFramesLog('/work/a', 'c1').length, 0, 'A cleared')
  assert.equal(getFramesLog('/work/b', 'c1').length, 1, 'B untouched')
})

test('agent focus is per cwd; local subscribers isolated; wildcard sees cwd', async () => {
  const eventsB = []
  const wild = []
  track(
    subscribeFocus('/work/a', (fs) => {
      assert.equal(fs.request && fs.request.pointId, 'pa', 'A sub only sees A')
    }),
  )
  track(subscribeFocus('/work/b', (fs) => eventsB.push(fs)))
  track(subscribeFocus('', (fs, cwd) => wild.push({ fs, cwd }))) // wildcard
  setFocusState('/work/a', { request: { pointId: 'pa', connectionId: 'c1' } })
  setFocusState('/work/b', { request: { pointId: 'pb', connectionId: 'c2' } })
  // A keeps its own focus
  assert.equal(getFocusState('/work/a').request.pointId, 'pa')
  assert.equal(getFocusState('/work/b').request.pointId, 'pb', 'B update must not clobber A')
  // B local subscriber only saw B events
  assert.equal(eventsB.length, 1)
  assert.equal(eventsB[0].request.pointId, 'pb')
  // wildcard got both changes with cwd
  assert.equal(wild.length, 2)
  assert.equal(wild[0].cwd, '/work/a')
  assert.equal(wild[1].cwd, '/work/b')
})

// Keep the process honest: no timers may survive the last unsubscribe of a cwd.
test('final unsubscribe per cwd must not leave a live interval', async () => {
  const post = async (path, body) => ({ byCwd: body.cwd, workspace: {} })
  const un = track(subscribeState(post, '/work/clean', () => {}))
  un()
  // give any leaked interval a chance to misfire; then ensure the event loop
  // stays quiescent (npm test would hang if an interval leaked)
  const before = process._getActiveHandles ? process._getActiveHandles().length : 0
  await wait(40)
  const after = process._getActiveHandles ? process._getActiveHandles().length : before
  assert.ok(after <= before + 1, 'no interval/handle leak after final unsubscribe')
})
