export function createHmiCommandClient(post, cwd, sessionId) {
  const send = (path, body = {}, timeout = 20000) => post(path, { cwd, sessionId, ...body }, timeout)

  const persistRuntime = (modbusPatch, extra = {}) =>
    send('/dsh-vision-bench/workspace', { modbus: { ...modbusPatch, version: 3 }, ...extra })

  const command = (action, payload = {}, timeout = 20000) =>
    send('/dsh-vision-bench/command', { action, payload: { ...payload, cwd }, source: 'user', sessionId }, timeout)

  const mutateConfig = (operation, target, value, expectedConfigVersion, timeout = 20000) =>
    command('config', { operation, target, value, expectedConfigVersion }, timeout)

  const refresh = () => send('/dsh-vision-bench/state', {})

  return { send, persistRuntime, command, mutateConfig, refresh }
}
