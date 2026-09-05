import type { DebugBackendKind } from './debug.d.ts'

export interface ResolvedTargetSpec {
  artifactPath: string
  artifactSha256?: string
  interfaceName: string
  target: string
  gdbPort: number
  openocdBin: string
  gdbBin: string
  probeSerial?: string
  cwd: string
  [key: string]: any
}

export interface DebugLaunchRequest {
  cwd?: string
  sessionId?: string
  source?: string
  backend?: DebugBackendKind
  targetSpec?: Partial<ResolvedTargetSpec>
  [key: string]: any
}

export interface ResolvedLaunchSpec {
  backend: DebugBackendKind
  targetSpec: ResolvedTargetSpec
  source: 'explicit' | 'auto-resolved' | 'keil-project'
  projectPath?: string
  targetName?: string
  launchFingerprint?: string
  launchSummary?: string
  [key: string]: any
}
