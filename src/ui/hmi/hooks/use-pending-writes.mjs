import { formatErrorMessage, pickJournal } from '../../common/ui-format.mjs'
import { ERROR_CODES } from '../../../domain/modbus/errors.mjs'

export function usePendingWrites(React, post, cwd, sessionId, setPending, setJournal, setWorkspace, setError, t) {
  const sid = sessionId ? String(sessionId) : ''
  const [resolvingId, setResolvingId] = React.useState('')
  const resolvingRef = React.useRef('')
  function resolveWrite(id, approved) {
    const requestId = String(id || '')
    if (!requestId || resolvingRef.current) return
    resolvingRef.current = requestId
    setResolvingId(requestId)
    post('/dsh-vision-bench/modbus/write/approve', { cwd, sessionId: sid, id, approved }, 120000)
      .then((data) => {
        if (data && data.ok === false && data.errorCode === ERROR_CODES.SESSION_MISMATCH) {
          // The request belongs to another session; leave the local list alone
          // and let the session-scoped state refresh below decide what is visible.
          setError(t('pendingWriteSessionMismatch'))
        } else {
          setPending((prev) => prev.filter((item) => item.id !== id))
          if (data && data.ok === false && !data.rejected) setError(formatErrorMessage(data.error) || t('fail'))
        }
        return post('/dsh-vision-bench/state', sid ? { cwd, sessionId: sid } : { cwd })
      })
      .then((data) => {
        if (!data) return
        if (Array.isArray(data.pendingWrites)) setPending(data.pendingWrites)
        setJournal(pickJournal(data))
        if (data.workspace?.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
        }
      })
      .catch((err) => {
        setError(String(err?.message || t('fail')))
      })
      .finally(() => {
        if (resolvingRef.current === requestId) {
          resolvingRef.current = ''
          setResolvingId('')
        }
      })
  }
  return { resolveWrite, resolvingId }
}
