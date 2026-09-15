export function statusKind(health) {
  if (!health || !health.bound) return 'unbound'
  return health.exists ? 'ready' : 'missing'
}

export function pluginVersionLabel() {
  // Build injects `v${package.json.version}`; unbundled source falls back to vdev.
  const injected =
    typeof globalThis !== 'undefined' && typeof globalThis.__DVB_BUILD_VERSION__ === 'string'
      ? globalThis.__DVB_BUILD_VERSION__
      : ''
  return injected || 'vdev'
}

export function ioStatusInfo(ioRuntime, t) {
  const state = ioRuntime && ioRuntime.state
  const isUnavailable = state === 'unavailable' || state === 'unhealthy' || state === 'stopped'
  const kind = isUnavailable ? 'missing' : 'ready'
  let label = t('ioReady')
  if (state === 'starting') label = t('ioPending')
  else if (isUnavailable) label = t('ioUnavailable')
  return { kind, label }
}
