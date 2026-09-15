import assert from 'node:assert/strict'
import {
  a,
  b,
} from '../../src/ui/foo.mjs'
export const TABLE = ['src/ui/bar.mjs']
export { helper } from '../../src/ui/helper.mjs'
const src = readFileSync(new URL('../bench-notify.mjs', import.meta.url), 'utf8')
