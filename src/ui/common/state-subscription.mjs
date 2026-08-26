// Per-cwd shared /state poller (split from bench-shared).
export const POLL_MS = 2000

const STATE_BUSES = new Map() // cwd -> { cwd, data, subs:Set, timer, seq, post }

function busEntry(post, cwd) {
  let e = STATE_BUSES.get(cwd)
  if (!e) {
    e = { cwd, data: null, subs: new Set(), timer: 0, seq: 0, post: null, sessionId: '' }
    STATE_BUSES.set(cwd, e)
  }
  // keep the freshest post fn (hot reload must not hold a stale closure)
  if (typeof post === 'function') e.post = post
  return e
}

function busPull(e) {
  const seq = ++e.seq
  const post = e.post
  if (typeof post !== 'function') return
  const payload = { cwd: e.cwd }
  if (e.sessionId) payload.sessionId = e.sessionId
  post('/dsh-vision-bench/state', payload)
    .then((data) => {
      // unsubscribed (map entry gone) or a newer request superseded this one
      if (!STATE_BUSES.has(e.cwd) || seq !== e.seq) return
      e.data = data
      for (const sub of Array.from(e.subs)) {
        try {
          sub(data)
        } catch {
          /* subscriber errors stay isolated */
        }
      }
    })
    .catch(() => {
      /* next tick retries */
    })
}

export function subscribeState(post, cwd, cb, opts) {
  if (!cwd) {
    cb(null)
    return () => {}
  }
  const e = busEntry(post, cwd)
  const sid = opts?.sessionId ? String(opts.sessionId) : ''
  if (sid) e.sessionId = sid
  // register BEFORE the first pull so an extremely fast response can't miss us
  e.subs.add(cb)
  if (e.subs.size === 1) {
    e.seq++ // cancel any stale in-flight response from a previous last subscriber
    busPull(e)
    if (e.timer) clearInterval(e.timer)
    e.timer = setInterval(() => busPull(e), POLL_MS)
  } else if (e.data) {
    // later subscribers get the cached snapshot immediately
    try {
      cb(e.data)
    } catch {
      /* isolate */
    }
  }
  return () => {
    const cur = STATE_BUSES.get(cwd)
    if (!cur || cur !== e) return
    cur.subs.delete(cb)
    if (cur.subs.size === 0) {
      clearInterval(cur.timer)
      cur.timer = 0
      cur.seq++ // in-flight responses must not deliver after final unsubscribe
      STATE_BUSES.delete(cwd)
    }
  }
}
