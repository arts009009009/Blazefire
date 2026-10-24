/**
 * Blazefire update check + updater — v1 parity surface.
 *
 *   maybeNotify()   dev-time prompt (fire-and-forget from the plugin)
 *   runUpdate()     the re-install the CLI and the prompt both run
 *   checkForUpdate() throttled feed check for `blazefire check`
 */
export { compareVersions, isValidVersion } from './semver.js'
export {
  CHECK_INTERVAL_MS,
  stateFile,
  readState,
  writeState,
  recentlyChecked,
} from './state.js'
export {
  getInstalledVersion,
  getRepoSlug,
  fetchLatestVersion,
  checkForUpdate,
} from './feed.js'
export type { CheckResult } from './feed.js'
export {
  detectPackageManager,
  resolveProjectRoot,
  readInstalledSpec,
  isSafeSpec,
  updateCommand,
  specTarget,
} from './pm.js'
export type { PackageManager } from './pm.js'
export { purgeCachedInstall, removeNpmLockEntry } from './cache-purge.js'
export { runUpdate, maybeNotify } from './updater.js'
export type { RunUpdateOptions } from './updater.js'
