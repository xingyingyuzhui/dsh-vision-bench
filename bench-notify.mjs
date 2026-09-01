import { randomUUID } from 'node:crypto'
import { loadWorkspace } from './bench-store.mjs'

const PLUGIN_NAME = 'dsh-vision-bench'
const SUMMARY_MAX = 160
const SENSITIVE = /(password|passwd|secret|token|api[_-]?key|authorization|bearer)\s*[:=]\s*\S+/gi

// Accepts either a registry object or a lazy resolver function so the agents
// service can appear after plugin apply() without being lost.
let agentsResolver = null

export const setAgentsRegistry = (registryOrResolver) => {
  if (typeof registryOrResolver === 'function') {
    agentsResolver = registryOrResolver
    return
  }
  agentsResolver = () => registryOrResolver || null
}

const currentAgents = () => {
  try {
    return agentsResolver ? agentsResolver() : null
  } catch {
    return null
  }
}

/** Notices must not look like a new user command, or DSH splices them into the inbox and the Agent re-runs them. */
export function formatVisionNotice(summary, detail = '') {
  const head = String(summary || '').trim()
  const body = /^(?:\[Vision|Vision)/.test(head)
    ? head
    : `[Vision 已生效] ${head}。这是配置结果通知，不是新的操作请求，不要再执行一遍。`
  const extra = String(detail || '').trim()
  return extra ? `${body}\n${extra}` : body
}

export function sanitizeNoticeSummary(summary) {
  let s = String(summary || '')
    .replace(SENSITIVE, '$1=[redacted]')
    .replace(/\s+/g, ' ')
    .trim()
  if (s.length > SUMMARY_MAX) s = `${s.slice(0, SUMMARY_MAX - 1)}…`
  return s || 'Vision notice'
}

export function buildPluginNotice(text, summary) {
  return {
    id: randomUUID(),
    role: 'user',
    content: [{ type: 'text', text: String(text || '') }],
    source: {
      kind: 'plugin',
      plugin: PLUGIN_NAME,
      form: 'notice',
      summary: sanitizeNoticeSummary(summary),
    },
  }
}

const buildMessage = (text, summary) => buildPluginNotice(text, summary)

export const notifyBenchEvent = async (home, cwd, summary, detail = '', opts = {}) => {
  try {
    if (!cwd) return { ok: false, skipped: 'no-cwd' }
    // Delivery target: an explicit originating session (whose request the
    // notice answers) wins; otherwise fall back to the workspace binding.
    let targetId = typeof opts.sessionId === 'string' ? opts.sessionId.trim() : ''
    if (!targetId) {
      const workspace = loadWorkspace(home, cwd)
      targetId = workspace && workspace.session && workspace.session.boundId ? workspace.session.boundId : ''
    }
    if (!targetId) return { ok: false, skipped: 'unbound' }
    const registry = currentAgents()
    if (!registry || typeof registry.get !== 'function') {
      return { ok: false, skipped: 'no-registry' }
    }
    const agent = registry.get(targetId)
    if (!agent) return { ok: false, skipped: 'agent-missing' }
    const deliver =
      typeof agent.followup === 'function'
        ? agent.followup.bind(agent)
        : typeof agent.steer === 'function'
          ? agent.steer.bind(agent)
          : null
    if (!deliver) return { ok: false, skipped: 'no-method' }
    const text = formatVisionNotice(summary, detail)
    const message = buildMessage(text, summary)
    await deliver(message)
    return { ok: true, boundId: targetId }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error).slice(0, 180) }
  }
}

// Route-level hook: notify on failures always, and on agent-sourced finishes
// (the origin session must learn the outcome of its approved request).
export const maybeNotifyResult = (home, cwd, label, ran) => {
  if (!ran || !cwd) return
  const failed = ran.ok === false && !ran.cancelled
  const fromAgent = ran.source === 'agent'
  if (!failed && !fromAgent) return
  const state = ran.ok === true ? '完成' : ran.cancelled ? '已取消' : '失败'
  const summary = 'Vision' + label + state + '：' + String(ran.summary || '').slice(0, 120)
  void notifyBenchEvent(home, cwd, summary, '', {
    sessionId: ran.sessionId || '',
  }).catch(() => {
    /* notice is best-effort */
  })
}

export const _internal = { PLUGIN_NAME, buildMessage, formatVisionNotice, sanitizeNoticeSummary }
