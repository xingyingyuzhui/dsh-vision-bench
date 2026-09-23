import type { ChildProcess } from 'node:child_process'
import type { Readable, Writable } from 'node:stream'

export type IoWorkerProcess = ChildProcess & {
  stdin: Writable
  stdout: Readable
  stderr: Readable
}

export type IoMessage = {
  id?: string
  ok?: boolean
  v?: unknown
  data?: Record<string, unknown>
  error?: unknown
  frames?: unknown
  transactionId?: unknown
  durationMs?: unknown
}

export type PendingEntry = {
  resolve: (value?: unknown) => void
  reject: (error: unknown) => void
  timer?: ReturnType<typeof setTimeout>
  abortCleanup?: () => void
  workerEpoch?: number
  settled?: boolean
}

export type IoErrorShape = { code?: string; message?: string }

export type IoRequestOpts = { timeoutMs?: unknown; signal?: AbortSignal }

export type IoBrokerOptions = {
  workerPath?: string
  execPath?: string
  env?: NodeJS.ProcessEnv
  onWorker?: (proc: IoWorkerProcess) => void
}
