// @ts-check
/**
 * Stage-5 Desktop evidence validators (shared by gate script + unit tests).
 */
import { createHash } from 'node:crypto'
import { existsSync, readFileSync } from 'node:fs'
import { join } from 'node:path'

/**
 * @param {string} path
 * @returns {string}
 */
export function sha256File(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex')
}

/**
 * @param {string} root
 * @returns {string}
 */
export function packageFingerprint(root) {
  const h = createHash('sha256')
  for (const rel of ['package.json', 'host.js', 'tools.js', 'client.js']) {
    const path = join(root, rel)
    if (!existsSync(path)) continue
    h.update(rel)
    h.update('\0')
    h.update(readFileSync(path))
    h.update('\0')
  }
  return h.digest('hex')
}

/**
 * @param {unknown} value
 * @returns {value is string}
 */
function nonEmptyString(value) {
  return typeof value === 'string' && value.trim().length > 0
}

/**
 * @param {Record<string, unknown>} data
 * @param {string[]} keys
 * @param {string[]} reasons
 */
function requireFields(data, keys, reasons) {
  for (const key of keys) {
    if (!(key in data) || data[key] === null || data[key] === undefined || data[key] === '') {
      reasons.push(`missing required field ${key}`)
    }
  }
}

/**
 * Validate schemaVersion=2 Desktop evidence against the current workspace.
 *
 * @param {Record<string, unknown>} data
 * @param {{
 *   kind: 'b2' | 'carrier',
 *   visionCommit: string,
 *   desktopCommit: string,
 *   visionDirtyNow: boolean,
 *   desktopDirtyNow: boolean,
 *   packageName: string,
 *   packageVersion: string,
 *   packageFingerprint: string,
 *   dshVersion: string,
 *   probeScriptPath: string,
 *   tarballArtifactPath?: string,
 *   allowDirty?: boolean,
 * }} ctx
 * @returns {{ ok: boolean, reasons: string[], treesClean: boolean }}
 */
export function validateStage5Evidence(data, ctx) {
  const reasons = []
  const allowDirty = ctx.allowDirty === true

  if (data.schemaVersion !== 2) {
    reasons.push(`schemaVersion must be 2 (got ${String(data.schemaVersion)})`)
  }
  if (data.ok !== true) reasons.push('ok!==true')

  requireFields(
    data,
    [
      'claim',
      'at',
      'gitCommit',
      'visionDirty',
      'desktopGitCommit',
      'desktopDirty',
      'package',
      'packageFingerprint',
      'probeScriptSha256',
      'dshVersion',
      'hostProtocolVersion',
    ],
    reasons,
  )

  if (nonEmptyString(data.gitCommit) && data.gitCommit !== ctx.visionCommit) {
    reasons.push(`vision gitCommit mismatch (evidence=${data.gitCommit} current=${ctx.visionCommit || '∅'})`)
  }
  if (nonEmptyString(data.desktopGitCommit) && data.desktopGitCommit !== ctx.desktopCommit) {
    reasons.push(
      `desktop gitCommit mismatch (evidence=${data.desktopGitCommit} current=${ctx.desktopCommit || '∅'})`,
    )
  }
  if (nonEmptyString(data.packageFingerprint) && data.packageFingerprint !== ctx.packageFingerprint) {
    reasons.push('packageFingerprint mismatch')
  }
  if (String(data.package || '') !== `${ctx.packageName}@${ctx.packageVersion}`) {
    reasons.push(`package mismatch (evidence=${data.package || '∅'})`)
  }
  if (nonEmptyString(data.dshVersion) && data.dshVersion !== ctx.dshVersion) {
    reasons.push(`dshVersion mismatch (evidence=${data.dshVersion} current=${ctx.dshVersion || '∅'})`)
  }
  if (
    data.hostProtocolVersion !== undefined &&
    data.hostProtocolVersion !== null &&
    typeof data.hostProtocolVersion !== 'number'
  ) {
    reasons.push('hostProtocolVersion must be a number')
  }

  if (!existsSync(ctx.probeScriptPath)) {
    reasons.push(`probe script missing at ${ctx.probeScriptPath}`)
  } else if (nonEmptyString(data.probeScriptSha256)) {
    const current = sha256File(ctx.probeScriptPath)
    if (data.probeScriptSha256 !== current) reasons.push('probeScriptSha256 mismatch')
  }

  const treesClean =
    ctx.visionDirtyNow === false &&
    ctx.desktopDirtyNow === false &&
    data.visionDirty === false &&
    data.desktopDirty === false

  if (!allowDirty) {
    if (ctx.visionDirtyNow || data.visionDirty === true) {
      reasons.push('vision working tree dirty (labOk may still pass with VISION_STAGE5_ALLOW_DIRTY=1)')
    }
    if (ctx.desktopDirtyNow || data.desktopDirty === true) {
      reasons.push('desktop working tree dirty (labOk may still pass with VISION_STAGE5_ALLOW_DIRTY=1)')
    }
  }

  if (ctx.kind === 'b2') {
    requireFields(
      data,
      [
        'presetMount',
        'presetId',
        'toolsStartEvent',
        'agentApplyRan',
        'childPass',
        'registeredToolNames',
        'identity',
        'visionFetch',
        'tarballSha256',
        'tarballArtifact',
      ],
      reasons,
    )
    if (data.claim !== 'runtime-identity-lab') reasons.push('claim!=runtime-identity-lab')
    if (data.presetMount !== 'agentPresets.mount') reasons.push('presetMount!=agentPresets.mount')
    if (data.presetId !== 'vision-b2') reasons.push('presetId!=vision-b2')
    if (data.toolsStartEvent !== 'vision.tools.start') reasons.push('toolsStartEvent missing')
    if (data.agentApplyRan !== true) reasons.push('agentApplyRan!==true')
    if (data.childPass !== true) reasons.push('childPass!==true')
    const tools = Array.isArray(data.registeredToolNames) ? data.registeredToolNames : []
    if (!tools.includes('vision_bench')) reasons.push('vision_bench not registered')
    const id =
      data.identity && typeof data.identity === 'object'
        ? /** @type {Record<string, unknown>} */ (data.identity)
        : {}
    if (id.samePid !== true) reasons.push('identity.samePid!==true')
    if (id.sameModuleInstance !== true) reasons.push('identity.sameModuleInstance!==true')
    if (id.hasHandle !== true) reasons.push('identity.hasHandle!==true')
    if (id.dispatchPath !== 'in-process-handle') reasons.push('identity.dispatchPath mismatch')
    if (!String(id.via || '').includes('agentPresets.mount')) reasons.push('identity.via missing mount')
    if (id.presetId !== 'vision-b2') reasons.push('identity.presetId!=vision-b2')

    const vf =
      data.visionFetch && typeof data.visionFetch === 'object'
        ? /** @type {Record<string, unknown>} */ (data.visionFetch)
        : {}
    if (vf.ok !== true || vf.stateOk !== true || vf.cancelOk !== true) {
      reasons.push('visionFetch identity/cancel incomplete')
    }

    const artifactPath = ctx.tarballArtifactPath || ''
    if (!artifactPath || !existsSync(artifactPath)) {
      reasons.push(`tarball artifact missing (${artifactPath || String(data.tarballArtifact || '∅')})`)
    } else if (!nonEmptyString(data.tarballSha256)) {
      reasons.push('tarballSha256 missing')
    } else if (!/^[a-f0-9]{64}$/.test(String(data.tarballSha256))) {
      reasons.push('tarballSha256 must be sha256 hex')
    } else {
      const actual = sha256File(artifactPath)
      if (actual !== data.tarballSha256) reasons.push('tarballSha256 mismatch vs saved artifact')
    }
  } else if (ctx.kind === 'carrier') {
    requireFields(data, ['abortObserved', 'cancelMs', 'cancelOutcome'], reasons)
    if (data.claim !== 'desktop-fetch-carrier') reasons.push('claim!=desktop-fetch-carrier')
    if (data.abortObserved !== true) reasons.push('abortObserved!==true')
    if (!(Number(data.cancelMs) > 0) || Number(data.cancelMs) > 2000) {
      reasons.push('cancelMs out of range')
    }
  }

  const labReasons = allowDirty
    ? reasons.filter((r) => !r.includes('working tree dirty'))
    : reasons

  return {
    ok: labReasons.length === 0,
    reasons: labReasons,
    treesClean,
  }
}

/**
 * Relative path under scripts/probes/evidence for the packed B2 tarball artifact.
 * @param {string} packageName
 * @param {string} packageVersion
 */
export function b2TarballArtifactRel(packageName, packageVersion) {
  return join('artifacts', `${packageName}-${packageVersion}.tgz`)
}
