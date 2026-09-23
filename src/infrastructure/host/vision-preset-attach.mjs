// @ts-check
/**
 * Host wiring for the Vision模式 Agent preset declaration (DSH 0.1.7+).
 *
 * Registration is best-effort enrichment: a registry failure must never fail
 * Host apply — the workbenches work without the Agent preset. A legacy (≤ 0.1.6)
 * registry keeps the directory seed path untouched.
 *
 * HMR evaluates a new copy of this module, so the in-flight unregister chain
 * lives on `globalThis[Symbol.for('dsh-vision-bench.preset-declaration')]`.
 * A fiber publishes "wait for my mount, then unregister" when it disposes;
 * the next fiber awaits that chain before calling `register`. `register`
 * itself does not return until the preset has mounted, and a taken id throws.
 *
 * @module
 */
import {
  HOST_PLUGIN_NAME,
  activateVisionPresetDeclaration,
  describeDeclaredPreset,
  isDeclarativeRegistry,
  presetDeclarationSlot,
  resetDeclarationState,
  setDeclarationState,
} from '../harness/preset-declaration.mjs'

/** Backstop when a dispose lands after the next fiber already gave the id up. */
const EXTERNAL_RECHECK_DELAY_MS = 2000

/**
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
function logPresetLifecycle(event, fields) {
  console.info(JSON.stringify({ event, fiber: HOST_PLUGIN_NAME, at: Date.now(), ...fields }))
}

/**
 * @param {unknown} error
 * @returns {string}
 */
function errorText(error) {
  return String((error && /** @type {any} */ (error).message) || error || '').slice(0, 300)
}

/**
 * @param {() => boolean} isDisposed
 * @param {number} epoch
 * @param {any} registry
 * @param {() => string} getHome
 */
async function recheckExternalDeclaration(isDisposed, epoch, registry, getHome) {
  if (isDisposed() || epoch !== presetDeclarationSlot().epoch) return
  const roster = await describeDeclaredPreset(registry)
  if (isDisposed() || epoch !== presetDeclarationSlot().epoch || roster.row) return
  try {
    const again = await activateVisionPresetDeclaration(registry, getHome(), { epoch, duplicateRetries: 0 })
    if (isDisposed() || epoch !== presetDeclarationSlot().epoch) return
    if (again.ok) {
      logPresetLifecycle('vision.preset.declaration-recheck', { ok: true, via: again.via })
      return
    }
    const error = errorText(again.error || roster.error || 'Vision预设声明复核后仍未注册')
    setDeclarationState({ mode: 'declarative', phase: 'failed', via: again.via, error }, epoch)
    logPresetLifecycle('vision.preset.declaration-recheck', { ok: false, error })
  } catch (error) {
    if (isDisposed() || epoch !== presetDeclarationSlot().epoch) return
    const message = errorText(error)
    setDeclarationState({ mode: 'declarative', phase: 'failed', error: message }, epoch)
    logPresetLifecycle('vision.preset.declaration-recheck', { ok: false, error: message })
  }
}

/**
 * @param {() => boolean} isDisposed
 * @param {number} epoch
 * @param {any} registry
 * @param {() => string} getHome
 * @param {number} delayMs
 * @returns {() => void}
 */
function scheduleExternalRecheck(isDisposed, epoch, registry, getHome, delayMs) {
  const timer = setTimeout(() => {
    void recheckExternalDeclaration(isDisposed, epoch, registry, getHome)
  }, delayMs)
  if (typeof timer.unref === 'function') timer.unref()
  return () => clearTimeout(timer)
}

/**
 * Build the optional `agentPresets` inject callback for the Host fiber.
 *
 * @param {any} ctx Host fiber context (fallback effect scope)
 * @param {{ getHome: () => string, recheckDelayMs?: number }} deps
 * @returns {(presetCtx: any) => void}
 */
export function createAgentPresetAttacher(ctx, deps) {
  const recheckDelayMs = deps.recheckDelayMs ?? EXTERNAL_RECHECK_DELAY_MS
  return (presetCtx) => {
    try {
      const registry = presetCtx && presetCtx.agentPresets
      if (!isDeclarativeRegistry(registry)) {
        setDeclarationState({ mode: 'legacy' })
        return
      }
      const effectHost = typeof presetCtx?.effect === 'function' ? presetCtx : ctx
      effectHost.effect(() => {
        const slot = presetDeclarationSlot()
        const epoch = ++slot.epoch
        let disposed = false
        /** @type {(() => Promise<void>) | null} */
        let unregister = null
        /** @type {(value?: void) => void} */
        let resolveMounted = () => {}
        const mounted = new Promise((resolve) => {
          resolveMounted = resolve
        })
        /** @type {() => void} */
        let cancelRecheck = () => {}
        const isDisposed = () => disposed

        Promise.resolve()
          .then(() => presetDeclarationSlot().settled)
          .catch(() => {})
          .then(() => {
            if (disposed || epoch !== presetDeclarationSlot().epoch) return null
            return activateVisionPresetDeclaration(registry, deps.getHome(), { epoch })
          })
          .then((result) => {
            if (!result) return
            unregister = result.dispose
            if (disposed || epoch !== presetDeclarationSlot().epoch) return
            if (result.via === 'external-declaration') {
              cancelRecheck = scheduleExternalRecheck(isDisposed, epoch, registry, () => deps.getHome(), recheckDelayMs)
            }
            logPresetLifecycle('vision.preset.declaration', {
              ok: result.ok === true,
              via: result.via,
              migrated: result.migration.migrated === true,
              error: errorText(result.error),
            })
          })
          .catch((error) => {
            const message = errorText(error)
            setDeclarationState({ mode: 'declarative', phase: 'failed', error: message }, epoch)
            logPresetLifecycle('vision.preset.declaration-failed', { error: message })
          })
          .finally(() => resolveMounted())

        return () => {
          disposed = true
          cancelRecheck()
          resetDeclarationState(epoch)
          presetDeclarationSlot().settled = mounted
            .then(async () => {
              const dispose = unregister
              unregister = null
              if (dispose) await dispose()
            })
            .catch(() => {})
        }
      })
    } catch (error) {
      logPresetLifecycle('vision.preset.declaration-failed', { error: errorText(error) })
    }
  }
}
