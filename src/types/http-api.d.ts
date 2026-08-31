import type { VisionBenchResult } from './modbus'
import type { WorkspaceConfig, WorkspaceRuntime } from './workspace'

export type HttpRequestLike = {
  method?: string
  headers?: Record<string, string | string[] | undefined>
  url?: string
}

export type HttpStateResponse = VisionBenchResult<{
  workspace?: {
    modbus?: WorkspaceConfig['modbus'] & WorkspaceRuntime['modbus']
    focus?: unknown
  }
  journal?: unknown
  health?: unknown
  pendingWrites?: unknown[]
}>

export type HostBridgeDescriptor = {
  origin: string
  inProcess: boolean
  available?: boolean
  transport?: 'in-process' | 'http'
  roundtripMs?: number
  errorCode?: string
  error?: string
}

export type HostPingData = {
  service: 'dsh-vision-bench' | string
  version: string
  transport: 'in-process' | 'http'
  pid: number
  timestamp: string
}

export type PostCommitWarning = {
  code: 'CONNECTION_RELEASE_FAILED' | 'EVENT_NOTIFY_FAILED' | string
  message: string
  connectionIds?: string[]
}

export type ConfigMutationErrorCode = 'CONFIG_DRIFT' | 'CONFIG_VERSION_REQUIRED' | 'CONFIG_INVALID'

export type WorkspaceRepositoryMutator = (
  current: unknown,
) =>
  | { ok: true; workspace: unknown }
  | { ok: false; errorCode?: string; error?: string }
  | Promise<{ ok: true; workspace: unknown } | { ok: false; errorCode?: string; error?: string }>

export type HttpApiPaths =
  | '/dsh-vision-bench/state'
  | '/dsh-vision-bench/workspace'
  | '/dsh-vision-bench/modbus/write'
  | '/dsh-vision-bench/modbus/write/approve'
  | '/dsh-vision-bench/focus'
  | '/dsh-vision-bench/command'
  | string
