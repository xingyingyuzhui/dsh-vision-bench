const MAX_LOG = 8
const SUMMARY_CAP = 180
const ACTIONS = new Set(['select-project', 'build', 'read'])

export const emptyLog = () => []

export const normalizeEvent = (input) => {
  const action = input && ACTIONS.has(input.action) ? input.action : 'build'
  const summary = String((input && input.summary) || '')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, SUMMARY_CAP)
  const at = Number(input && input.at)
  return {
    at: Number.isFinite(at) && at > 0 ? at : Date.now(),
    action,
    ok: !!(input && input.ok),
    summary,
  }
}

export const mergeLog = (prev, event) => {
  const next = [normalizeEvent(event)]
  const old = Array.isArray(prev) ? prev : []
  for (const item of old) {
    if (next.length >= MAX_LOG) break
    next.push(normalizeEvent(item))
  }
  return next
}
