import { pickJournal } from '../../../../bench-shared.mjs'

export function usePendingWrites(React, post, cwd, setPending, setJournal, setWorkspace, setError, t) {
  void React
  function resolveWrite(id, approved) {
    post('/dsh-vision-bench/modbus/write/approve', { cwd, id, approved }, 120000)
      .then((data) => {
        setPending((prev) => prev.filter((item) => item.id !== id))
        if (data && data.ok === false && !data.rejected) setError(data.error || t('fail'))
        return post('/dsh-vision-bench/state', { cwd })
      })
      .then((data) => {
        if (!data) return
        setJournal(pickJournal(data))
        if (data.workspace?.modbus) {
          setWorkspace((prev) => ({ ...prev, modbus: data.workspace.modbus || prev.modbus }))
        }
      })
      .catch((err) => {
        setError(String(err?.message || t('fail')))
      })
  }
  return { resolveWrite }
}
