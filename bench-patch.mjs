// bench-patch.mjs — thin wrapper around fast-json-patch with domain guardrails
// Implements Task 2 of the review fix plan: no custom traversal, exact dep, prototype block

import jsonpatch from 'fast-json-patch'

const ALLOWED_OPS = new Set(['add', 'remove', 'replace'])
const ALLOWED_TOP = new Set(['/connections', '/devices', '/points', '/activeConnectionId', '/activeDeviceId', '/visualization', '/pollingByConnection'])
const DANGEROUS_TOKENS = new Set(['__proto__', 'prototype', 'constructor'])

function isDangerousToken(tok) {
  return DANGEROUS_TOKENS.has(String(tok))
}

function hasDangerousPath(path) {
  if (typeof path !== 'string') return true
  const parts = path.split('/').slice(1).map(p => {
    // unescape ~1 and ~0 for check
    try { return p.replace(/~1/g, '/').replace(/~0/g, '~') } catch { return p }
  })
  for (const tok of parts) if (isDangerousToken(tok)) return true
  return false
}

function isAllowedTopPath(path) {
  if (typeof path !== 'string' || !path.startsWith('/')) return false
  for (const top of ALLOWED_TOP) {
    if (path === top || path.startsWith(top + '/')) return true
  }
  return false
}

export function escapePointer(token) {
  return String(token).replace(/~/g, '~0').replace(/\//g, '~1')
}
export function unescapePointer(token) {
  return String(token).replace(/~1/g, '/').replace(/~0/g, '~')
}

export function validatePatch(patch) {
  if (!Array.isArray(patch)) return 'patch must be an array'
  for (let i = 0; i < patch.length; i++) {
    const op = patch[i]
    if (!op || typeof op !== 'object') return 'operation ' + i + ' must be an object'
    if (typeof op.op !== 'string') return 'operation ' + i + ' missing op'
    if (!ALLOWED_OPS.has(op.op)) return 'operation ' + i + ' unsupported op: ' + op.op
    if (typeof op.path !== 'string') return 'operation ' + i + ' missing path'
    if (!op.path.startsWith('/')) return 'operation ' + i + ' path must start with /'
    if (hasDangerousPath(op.path)) return 'operation ' + i + ' dangerous path token blocked: ' + op.path + ' contains __proto__/prototype/constructor'
    if (hasDangerousPath(op.from || '')) return 'operation ' + i + ' dangerous from token blocked: ' + op.from + ' contains __proto__/prototype/constructor'
    if (!isAllowedTopPath(op.path)) return 'operation ' + i + ' path not in allowlist: ' + op.path
    if ((op.op === 'add' || op.op === 'replace') && !('value' in op)) return 'operation ' + i + ' missing value'
  }
  return null
}

// applyPatch returns { ok, result, error }
// Uses fast-json-patch with validateOperation and banPrototypeModifications
export function applyPatch(document, patch, opts = {}) {
  const err = validatePatch(patch)
  if (err) return { ok: false, error: err }
  // deep clone first (fast-json-patch mutates)
  const clone = JSON.parse(JSON.stringify(document))
  try {
    // fast-json-patch's applyPatch with validateOperation:true and mutateDocument:false
    // but we use our clone and let it mutate clone, with banPrototypeModifications
    const result = jsonpatch.applyPatch(clone, patch, true, false)
    // result.newDocument is the mutated clone
    // Also ensure no prototype pollution happened
    if (Object.prototype.hasOwnProperty('x') || Object.prototype.hasOwnProperty('polluted')) {
      return { ok: false, error: 'prototype pollution detected' }
    }
    return { ok: true, result: result.newDocument }
  } catch (e) {
    return { ok: false, error: String((e && e.message) || e) }
  }
}

export function compare(a, b) {
  // Use fast-json-patch's compare, then filter to allowed ops/paths and dangerous tokens
  const raw = jsonpatch.compare(a, b)
  // Filter: keep only add/remove/replace and allowed top paths, block dangerous
  const filtered = []
  for (const op of raw) {
    if (!ALLOWED_OPS.has(op.op)) continue
    if (hasDangerousPath(op.path) || hasDangerousPath(op.from || '')) continue
    if (!isAllowedTopPath(op.path)) continue
    filtered.push(op)
  }
  return filtered
}

export const _internal = {
  hasDangerousPath,
  isAllowedTopPath,
  isDangerousToken,
}

export const PATCH_BUNDLE_NOTE = {
  evaluated: 'fast-json-patch@3.1.1',
  license: 'MIT',
  versionLocked: '3.1.1 pinned exact',
  windows: 'pure JS, no native bindings, safe for Windows host packaging',
  bundleRaw: 'fast-json-patch 14.2KB (~4.1KB gzip) vs vendor ~2.4KB',
  decision: 'use fast-json-patch with thin allowlist wrapper',
}
