// @ts-check
/**
 * Transaction harness for `createConfigMutationService({ repositoryFactory })`.
 *
 * Hands a RAW (never normalized) fixture straight to the real mutation
 * callback so same-layer deviceId twins are still present when candidate
 * validation runs. Records the callback result and simulates commit + version
 * bump only when the callback returns ok — a rejected mutation must not commit.
 * Fixtures must NOT be built through `saveWorkspace` (its save-time
 * `validateCandidateDeviceLayers` would reject the raw twins up front).
 */
import { createConfigMutationService } from '../../src/application/config/config-mutation-service.mjs'

/**
 * @param {any} fixture raw workspace fixture
 */
export function rawMutationHarness(fixture) {
  /** @type {{ commits: number, calls: number, result: any }} */
  const log = { commits: 0, calls: 0, result: null }
  const service = createConfigMutationService({
    repositoryFactory: () => ({
      /**
       * @param {string} cwd
       * @param {number} expectedVersion
       * @param {(current: any) => Promise<any> | any} run
       */
      mutateConfig: async (cwd, expectedVersion, run) => {
        void cwd
        void expectedVersion
        log.calls += 1
        const next = await run(fixture)
        log.result = next
        if (!next || next.ok !== true) return next
        log.commits += 1
        const previousConfigVersion = Number(fixture?.modbus?.configVersion) || 1
        const workspace = next.workspace
        workspace.modbus = { ...workspace.modbus, configVersion: previousConfigVersion + 1 }
        return {
          ok: true,
          previousConfigVersion,
          nextConfigVersion: previousConfigVersion + 1,
          workspace,
        }
      },
    }),
  })
  return { service, log }
}
