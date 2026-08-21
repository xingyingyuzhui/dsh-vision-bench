import { loadWorkspace } from './bench-store.mjs'

const PLUGIN_NAME = 'dsh-vision-bench'

let agentsRegistry = null

export const setAgentsRegistry = (registry) => {
  agentsRegistry = registry || null
}

const buildMessage = async (text, summary) => {
  try {
    const mod = await import('@deepseek-ai/dsh-llm')
    if (mod && typeof mod.createUserMessage === 'function') {
      return mod.createUserMessage({
        content: [{ type: 'text', text }],
        source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'notice', summary },
      })
    }
  } catch { /* not bundled with core llm; fall through */ }
  return {
    role: 'user',
    content: [{ type: 'text', text }],
    source: { kind: 'plugin', plugin: PLUGIN_NAME, form: 'notice', summary },
  }
}

export const notifyBenchEvent = async (home, cwd, summary, detail = '') => {
  try {
    if (!cwd) return { ok: false, skipped: 'no-cwd' }
    const workspace = loadWorkspace(home, cwd)
    const boundId = workspace && workspace.session && workspace.session.boundId
    if (!boundId) return { ok: false, skipped: 'unbound' }
    if (!agentsRegistry || typeof agentsRegistry.get !== 'function') {
      return { ok: false, skipped: 'no-registry' }
    }
    const agent = agentsRegistry.get(boundId)
    if (!agent) return { ok: false, skipped: 'agent-missing' }
    const deliver = typeof agent.followup === 'function'
      ? agent.followup.bind(agent)
      : (typeof agent.steer === 'function' ? agent.steer.bind(agent) : null)
    if (!deliver) return { ok: false, skipped: 'no-method' }
    const text = detail ? summary + '\n' + detail : summary
    const message = await buildMessage(text, summary)
    await deliver(message)
    return { ok: true, boundId }
  } catch (error) {
    return { ok: false, error: String((error && error.message) || error).slice(0, 180) }
  }
}

export const maybeNotifyResult = (home, cwd, label, ran) => {
  if (!ran || !cwd) return
  const failed = ran.ok === false && !ran.cancelled
  const fromAgent = ran.source === 'agent'
  if (!failed && !fromAgent) return
  const state = ran.ok === true ? '完成' : (ran.cancelled ? '已取消' : '失败')
  const summary = '台架' + label + state + '：' + String(ran.summary || '').slice(0, 120)
  void notifyBenchEvent(home, cwd, summary).catch(() => { /* notice is best-effort */ })
}

export const _internal = { PLUGIN_NAME, buildMessage }
