// @ts-check

/**
 * Native GDB/MI Record data representation.
 */
export class MIRecord {
  /**
   * @param {{
   *   token?: number | null,
   *   kind: 'result' | 'exec-async' | 'status-async' | 'notify-async' | 'console-stream' | 'target-stream' | 'log-stream' | 'prompt',
   *   class?: string,
   *   results?: Record<string, any>,
   *   text?: string,
   * }} options
   */
  constructor(options) {
    this.token = typeof options.token === 'number' ? options.token : null
    this.kind = options.kind
    this.class = options.class || ''
    this.results = options.results || {}
    this.text = options.text || ''
  }
}
