// Per-session+cwd shared /state poller (split from bench-shared).
export const POLL_MS = 2000

const STATE_BUSES = new Map() // sessionId\0cwd -> { key, cwd, sessionId, data, subs, timer, seq, post }

export function stateBusKey(sessionId, cwd) {
  return `${String(sessionId || '')}\0${String(cwd || '')}`
}

function busEntry(post, cwd, sessionId) {
  const key = stateBusKey(sessionId, cwd)
  let e = STATE_BUSES.get(key)
  if (!e) {
    e = {
      key,
      cwd: String(cwd || ''),
      sessionId: String(sessionId || ''),
      data: null,
      subs: new Set(),
      timer: 0,
      seq: 0,
      post: null,
    }
    STATE_BUSES.set(key, e)
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
      if (!STATE_BUSES.has(e.key) || seq !== e.seq) return
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
  const sid = opts?.sessionId ? String(opts.sessionId) : ''
  const e = busEntry(post, cwd, sid)
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
    const cur = STATE_BUSES.get(e.key)
    if (!cur || cur !== e) return
    cur.subs.delete(cb)
    if (cur.subs.size === 0) {
      clearInterval(cur.timer)
      cur.timer = 0
      cur.seq++ // in-flight responses must not deliver after final unsubscribe
      STATE_BUSES.delete(e.key)
    }
  }
}
