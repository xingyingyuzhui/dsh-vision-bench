export type IoRequest =
  | { type: 'open'; connectionId: string; endpoint: Record<string, unknown> }
  | { type: 'close'; connectionId: string }
  | { type: 'read'; connectionId: string; unitId: number; function: number; address: number; quantity: number }
  | {
      type: 'write'
      connectionId: string
      unitId: number
      function: number
      address: number
      values: Array<number | boolean>
    }

export type IoResponse = {
  ok: boolean
  errorCode?: string
  error?: string
  values?: Array<number | boolean>
  frames?: unknown[]
  framesLog?: unknown[]
}
