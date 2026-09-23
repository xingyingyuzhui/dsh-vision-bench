// @ts-check
/**
 * Host wiring for the Vision模式 Agent preset declaration (DSH 0.1.7+).
 *
 * Registration is best-effort enrichment: a registry failure must never fail
 * Host apply — the workbenches work without the Agent preset. A legacy (≤ 0.1.6)
 * registry keeps the directory seed path untouched.
 *
 * @module
 */
import {
  HOST_PLUGIN_NAME,
  activateVisionPresetDeclaration,
  isDeclarativeRegistry,
  resetDeclarationState,
  setDeclarationState,
} from '../harness/preset-declaration.mjs'

/**
 * @param {string} event
 * @param {Record<string, unknown>} fields
 */
function logPresetLifecycle(event, fields) {
  console.info(JSON.stringify({ event, fiber: HOST_PLUGIN_NAME, at: Date.now(), ...fields }))
}

/**
 * Build the optional `agentPresets` inject callback for the Host fiber.
 *
 * @param {any} ctx Host fiber context (fallback effect scope)
 * @param {{ getHome: () => string }} deps
 * @returns {(presetCtx: any) => void}
 */
export function createAgentPresetAttacher(ctx, deps) {
  return (presetCtx) => {
    try {
      const registry = presetCtx && presetCtx.agentPresets
      if (!isDeclarativeRegistry(registry)) {
        setDeclarationState({ mode: 'legacy' })
        return
      }
      const effectHost = typeof presetCtx?.effect === 'function' ? presetCtx : ctx
      effectHost.effect(() => {
        let disposed = false
        /** @type {(() => Promise<void>) | null} */
        let unregister = null
        void Promise.resolve()
          .then(() => activateVisionPresetDeclaration(registry, deps.getHome()))
          .then((activation) => {
            const dispose = activation.dispose
            if (disposed) {
              if (dispose) {
                void Promise.resolve()
                  .then(() => dispose())
                  .catch(() => {})
              }
              return
            }
            unregister = dispose
            logPresetLifecycle('vision.preset.declaration', {
              ok: activation.ok === true,
              via: activation.via,
              migrated: activation.migration.migrated === true,
              error: String(activation.error || '').slice(0, 300),
            })
          })
          .catch((error) => {
            setDeclarationState({
              mode: 'declarative',
              phase: 'failed',
              error: String((error && /** @type {any} */ (error).message) || error).slice(0, 300),
            })
            logPresetLifecycle('vision.preset.declaration-failed', {
              error: String((error && /** @type {any} */ (error).message) || error).slice(0, 300),
            })
          })
        return () => {
          disposed = true
          resetDeclarationState()
          const dispose = unregister
          unregister = null
          if (dispose) {
            void Promise.resolve()
              .then(() => dispose())
              .catch(() => {})
          }
        }
      })
    } catch (error) {
      logPresetLifecycle('vision.preset.declaration-failed', {
        error: String(error && /** @type {any} */ (error).message ? /** @type {any} */ (error).message : error).slice(0, 300),
      })
    }
  }
}
