#!/usr/bin/env node
import { verifyBuildInfo } from './gen-build-info.mjs'

const result = verifyBuildInfo()
if (!result.ok) {
  console.error(result.error)
  process.exit(1)
}
console.log(`build-info ok buildId=${result.buildId.slice(0, 12)}… version=${result.pluginVersion}`)
