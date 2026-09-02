import type { VisionBenchResult } from './modbus'
import type { WorkspaceConfig, WorkspaceRuntime } from './workspace'

export type ConnectionRpcFailure = {
  code: string
  message: string
  details: object
}

export type ConnectionRpcResult<T = unknown> = { ok: true; value: T } | { ok: false; error: ConnectionRpcFailure }

export type ConnectionRpcLike = {
  rpc?: {
    call?: (
      channel: string,
      endpoint: string,
      payload: unknown,
      signal?: AbortSignal,
    ) => Promise<ConnectionRpcResult<unknown>>
    handle?: (
      channel: string,
      handler: (endpoint: string, payload: unknown, signal: AbortSignal) => Promise<ConnectionRpcResult<unknown>>,
    ) => (() => Promise<void>) | Promise<() => Promise<void>>
  }
}

export type VisionRpcTransport = 'connection-rpc' | 'in-process' | 'http'

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
  transport?: VisionRpcTransport
  roundtripMs?: number
  errorCode?: string
  error?: string
}

export type HostPingData = {
  service: 'dsh-vision-bench' | string
  version: string
  transport: VisionRpcTransport
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

export type OpenOcdProbeResponse = {
  ok: true
  ready: boolean
  bound: boolean
  exists: boolean
  errorCode?: string
  reason?: string
  versionLine?: string
}

export type HttpApiPaths = '/dsh-vision-bench/command' | string

export type VisionRpcEndpoint =
  | 'state'
  | 'bindings/save'
  | 'workspace/save'
  | 'project/file'
  | 'keil/map'
  | 'keil/build'
  | 'modbus/read'
  | 'modbus/write'
  | 'modbus/write/approve'
  | 'command'
  | string
