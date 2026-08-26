import type { VisionBenchResult } from './modbus'
import type { WorkspaceConfig, WorkspaceRuntime } from './workspace'

export type HttpStateResponse = VisionBenchResult<{
  workspace?: {
    modbus?: WorkspaceConfig['modbus'] & WorkspaceRuntime['modbus']
    configDrafts?: unknown[]
    focus?: unknown
  }
  journal?: unknown
  health?: unknown
  pendingWrites?: unknown[]
}>

export type HttpApiPaths =
  | '/dsh-vision-bench/state'
  | '/dsh-vision-bench/workspace'
  | '/dsh-vision-bench/modbus/write'
  | '/dsh-vision-bench/modbus/write/approve'
  | '/dsh-vision-bench/focus'
  | string
