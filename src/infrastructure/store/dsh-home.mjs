import { homedir } from 'node:os'
import { join } from 'node:path'

export const defaultDshHome = (env = process.env, home = homedir()) => env.DSH_HOME || join(home, '.dsh')
