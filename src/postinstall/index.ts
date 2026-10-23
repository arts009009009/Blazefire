/**
 * Blazefire activation engine — one implementation, consumed by both the
 * postinstall hook and `npx blazefire init|restore`.
 *
 * Public surface mirrors v1 blazefire/postinstall.cjs.
 */
export { SNIPPET, plan, rewrite, findTopLevel } from './scanner.js'
export type { ActivationPlan, RewriteResult } from './scanner.js'
export {
  CONFIG_NAMES,
  BACKUP_DIR,
  MARKER,
  HOOK_COMMAND,
  findConfig,
  isLifecycleHook,
  ensureHook,
  undoHook,
  locateCandidates,
  run,
  restore,
} from './activation.js'
