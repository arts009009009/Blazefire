/**
 * Activation driver — the filesystem half of the pipeline.
 *
 * Ported from v1 blazefire/postinstall.cjs. Safety invariants kept intact:
 *
 *   1. never throws; every entry point catches and swallows
 *   2. only writes a next.config.* inside the host project, never our package
 *   3. requires Next.js to be resolvable from the project before writing
 *   4. backups to "<project>/Blazefire Backup/"; an existing backup is never
 *      overwritten (the first copy is the pristine pre-Blazefire original)
 *   5. idempotent — already-activated configs are left alone
 *
 * The rewriting itself lives in ./scanner.ts; this file is all fs.
 */
import fs from 'node:fs'
import { createRequire } from 'node:module'
import path from 'node:path'
import { PACKAGE_ROOT } from '../package-root.js'
import { CJS_REQUIRE, rewrite, SNIPPET } from './scanner.js'

export const CONFIG_NAMES = [
  'next.config.js',
  'next.config.mjs',
  'next.config.cjs',
  'next.config.ts',
  'next.config.mts',
  'next.config.cts',
]

export const BACKUP_DIR = 'Blazefire Backup'
export const MARKER = ' (Blazefire)'

export const HOOK_COMMAND = 'blazefire init || echo blazefire skipped'
const SKIP_ENV = 'BLAZEFIRE_SKIP_AUTO'

type HookStatus =
  | { status: 'already-active' }
  | { status: 'changed' }
  | { status: 'no-package-json' }
  | { status: 'invalid-package-json' }
  | { status: 'host-script-invalid' }

function say(text: string): void {
  process.stdout.write(`[Blazefire] ${text}\n`)
}

function isSelf(target: string): boolean {
  try {
    const root = PACKAGE_ROOT.replace(/\\/g, '/').replace(/\/$/, '')
    const normalised = path.resolve(target).replace(/\\/g, '/').replace(/\/$/, '')
    return normalised === root || normalised.startsWith(`${root}/`)
  } catch {
    return false
  }
}

export function findConfig(start: string): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (!isSelf(dir)) {
      for (const name of CONFIG_NAMES) {
        const candidate = path.join(dir, name)
        if (fs.existsSync(candidate)) return candidate
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

function listWorkspaces(packageRoot: string): string[] {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return []

  let packageJson: { workspaces?: string[] | { packages?: string[] } }
  try {
    packageJson = JSON.parse(fs.readFileSync(packageJsonPath, 'utf8')) as never
  } catch {
    return []
  }

  const patterns = Array.isArray(packageJson.workspaces)
    ? packageJson.workspaces
    : (packageJson.workspaces?.packages ?? [])

  const results = new Set<string>()
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.startsWith('!')) continue
    for (const workspaceRoot of expandWorkspacePattern(packageRoot, pattern)) {
      if (!fs.existsSync(path.join(workspaceRoot, 'package.json'))) continue
      if (!CONFIG_NAMES.some((name) => fs.existsSync(path.join(workspaceRoot, name)))) {
        continue
      }
      results.add(workspaceRoot)
    }
  }

  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || !pattern.startsWith('!')) continue
    for (const workspaceRoot of expandWorkspacePattern(packageRoot, pattern.slice(1))) {
      results.delete(workspaceRoot)
    }
  }

  return [...results]
}

/** Directories a workspace `**` expansion must never descend into. */
const PRUNED_WORKSPACE_DIRS = new Set(['node_modules', '.git', '.next'])

function expandWorkspacePattern(packageRoot: string, pattern: string): string[] {
  const segments = pattern.split(/[\\/]+/).filter(Boolean)
  const matches: string[] = []

  const visit = (dir: string, index: number): void => {
    if (index === segments.length) {
      matches.push(dir)
      return
    }

    const segment = segments[index]!
    if (segment === '**') {
      visit(dir, index + 1)
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      for (const entry of entries) {
        // A root-level `**` must never descend into dependency or build
        // output trees: a dependency containing its own package.json +
        // next.config.js would otherwise be "discovered" as a workspace and
        // activated (writing into node_modules, wiped on the next install).
        if (entry.isDirectory() && !PRUNED_WORKSPACE_DIRS.has(entry.name)) {
          visit(path.join(dir, entry.name), index)
        }
      }
      return
    }

    if (segment.includes('*') || segment.includes('?')) {
      let entries: fs.Dirent[]
      try {
        entries = fs.readdirSync(dir, { withFileTypes: true })
      } catch {
        return
      }
      const matcher = new RegExp(
        `^${segment.replace(/[.+^${}()|[\]\\]/g, '\\$&').replace(/\*/g, '.*').replace(/\?/g, '.')}$`
      )
      for (const entry of entries) {
        if (entry.isDirectory() && matcher.test(entry.name)) {
          visit(path.join(dir, entry.name), index + 1)
        }
      }
      return
    }

    visit(path.join(dir, segment), index + 1)
  }

  visit(path.resolve(packageRoot), 0)
  return matches
}

/**
 * Next.js must be resolvable from the project's *own* node_modules, so the
 * plugin cannot be silently activating a tree that never runs it.
 * Uses createRequire (not a bare `require`) so the engine runs in ESM dist
 * and CJS test transforms alike.
 */
const resolveFrom = createRequire(path.join(PACKAGE_ROOT, 'package.json')).resolve

function hasInstalledNext(projectRoot: string): boolean {
  for (const modulePath of ['next/package.json', 'next/dist/server/next.js']) {
    const target = path.join(projectRoot, 'node_modules', ...modulePath.split('/'))
    try {
      resolveFrom(modulePath, { paths: [projectRoot] })
      return true
    } catch {
      if (fs.existsSync(target)) return true
    }
  }
  return false
}

function writeAtomicSync(target: string, contents: string | Buffer): void {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.tmp`
  )
  // Preserve the original file mode by copying it before writing
  let originalMode: number | undefined
  try {
    const stat = fs.statSync(target)
    originalMode = stat.mode
  } catch {
    // File doesn't exist yet, use default mode
  }
  fs.writeFileSync(temp, contents)
  if (originalMode !== undefined) {
    fs.chmodSync(temp, originalMode)
  }
  fs.renameSync(temp, target)
}

export function locateCandidates(start: string): {
  configs: string[]
  packageRoots: string[]
} {
  // Dedupe by CONFIG PATH, never by directory: a project can legitimately
  // carry several next.config.* files (Next only reads one, but which one is
  // version-dependent — wrapping every candidate is the only way to guarantee
  // the file that actually runs is wrapped). packageRoots stays parallel to
  // configs; the same root appearing twice is harmless downstream (hookRoots
  // and restore both dedupe).
  const seenConfigs = new Set<string>()
  const packageRoots: string[] = []
  const configs: string[] = []

  const collect = (configPath: string): void => {
    if (seenConfigs.has(configPath)) return
    seenConfigs.add(configPath)
    packageRoots.push(path.dirname(configPath))
    configs.push(configPath)
  }

  const resolvedRoot = resolveProjectRoot(start)
  if (resolvedRoot) {
    for (const name of CONFIG_NAMES) {
      const configPath = path.join(resolvedRoot, name)
      if (fs.existsSync(configPath)) collect(configPath)
    }
    for (const workspaceRoot of listWorkspaces(resolvedRoot)) {
      for (const name of CONFIG_NAMES) {
        const configPath = path.join(workspaceRoot, name)
        if (fs.existsSync(configPath)) collect(configPath)
      }
    }
    if (configs.length > 0) return { configs, packageRoots }
  }

  const fallback = findConfig(start)
  if (fallback) collect(fallback)
  return { configs, packageRoots }
}

export function ensureHook(packageRoot: string): HookStatus {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return { status: 'no-package-json' }

  const raw = fs.readFileSync(packageJsonPath, 'utf8')
  // A Windows-authored package.json may start with a UTF-8 BOM, which
  // JSON.parse rejects (npm itself strips it) — strip for parsing, put it
  // back on write so the file stays byte-familiar to its author.
  const hadBom = raw.charCodeAt(0) === 0xfeff
  const contents = hadBom ? raw.slice(1) : raw
  let parsed: Record<string, unknown> & { scripts?: Record<string, string> }
  try {
    parsed = JSON.parse(contents) as never
  } catch {
    return { status: 'invalid-package-json' }
  }
  // Valid JSON but not a package.json shape (an array, a bare string, …) —
  // rewriting it would REPLACE the whole document with a scripts object.
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { status: 'invalid-package-json' }
  }
  if (
    parsed.scripts !== undefined &&
    parsed.scripts !== null &&
    (typeof parsed.scripts !== 'object' || Array.isArray(parsed.scripts))
  ) {
    return { status: 'host-script-invalid' }
  }

  const eol = contents.includes('\r\n') ? '\r\n' : '\n'
  const scripts = { ...(parsed.scripts ?? {}) }

  const existing = scripts.postinstall
  if (existing !== undefined && existing !== null && typeof existing !== 'string') {
    // `postinstall: 42` is a host bug we must not silently rewrite into a
    // shell command — leave the file byte-for-byte alone.
    return { status: 'host-script-invalid' }
  }
  if (!existing) {
    scripts.postinstall = HOOK_COMMAND
  } else if (!isLifecycleHook(existing)) {
    // A host's own postinstall is not ours to clobber — chain ours after it,
    // grouped so a `;`, background `&` or trailing comment in the host's
    // script can never swallow or skip our hook (v1 chained bare and lost it).
    scripts.postinstall = chainAfterHost(existing)
  }
  // else: our hook is already present (pure, or chained after a host prefix).
  // Leave it exactly as-is — overwriting here silently deleted the host's own
  // command (e.g. "husky") on every re-install.

  if (JSON.stringify(scripts) === JSON.stringify(parsed.scripts ?? {})) {
    return { status: 'already-active' }
  }

  const trailingNewline = contents.endsWith('\n')
  // Preserve indentation style: detect tabs vs spaces from the original file
  // by checking if it contains tabs before any content
  const hasTabs = /^[^\S\n]*\t/.test(contents)
  const indentSize = hasTabs ? undefined : 2
  
  // `.replace(/\n/g, eol)` normalises stringify's structural newlines so a
  // CRLF package.json comes back as CRLF throughout (never mixed).
  const body = JSON.stringify({ ...parsed, scripts }, null, indentSize).replace(/\n/g, eol)
  const next = `${hadBom ? '\uFEFF' : ''}${body}${trailingNewline ? eol : ''}`
  writeAtomicSync(packageJsonPath, next)
  say(`activated the host hook in ${path.relative(process.cwd(), packageJsonPath) || packageJsonPath}`)
  return { status: 'changed' }
}

export function undoHook(packageRoot: string): {
  changed: boolean
  previousScripts?: Record<string, string>
} {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return { changed: false }

  const raw = fs.readFileSync(packageJsonPath, 'utf8')
  const hadBom = raw.charCodeAt(0) === 0xfeff
  const contents = hadBom ? raw.slice(1) : raw
  let parsed: Record<string, unknown> & { scripts?: Record<string, string> }
  try {
    parsed = JSON.parse(contents) as never
  } catch {
    return { changed: false }
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    return { changed: false }
  }

  const scripts = parsed.scripts
  if (!scripts) return { changed: false }

  const postinstall = scripts.postinstall
  if (!postinstall) return { changed: false }
  // A non-string script is a host bug; `.replace` on it would throw and abort
  // the rest of a multi-project restore. Leave it alone.
  if (typeof postinstall !== 'string') return { changed: false }

  const previousScripts = { ...scripts }
  const eol = contents.includes('\r\n') ? '\r\n' : '\n'

  const escaped = HOOK_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutHost = unwrapGroup(
    postinstall.replace(new RegExp(`\\s*&&\\s*${escaped}`), '').trim()
  )
  if (!withoutHost || withoutHost === HOOK_COMMAND) delete scripts.postinstall
  else scripts.postinstall = withoutHost

  const trailingNewline = contents.endsWith('\n')
  const body = JSON.stringify({ ...parsed, scripts }, null, 2).replace(/\n/g, eol)
  const next = `${hadBom ? '\uFEFF' : ''}${body}${trailingNewline ? eol : ''}`
  writeAtomicSync(packageJsonPath, next)
  return { changed: true, previousScripts }
}

export function isLifecycleHook(value: string): boolean {
  const escapedHook = HOOK_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  return new RegExp(`(?:^|&&\\s*)${escapedHook}(?:\\s|$)`).test(value)
}

/**
 * Shell operators that would swallow or mis-scope a blindly-appended
 * `&& <hook>`: `;` and newlines start a NEW statement, a single background
 * `&` is a statement terminator (and makes a bare `x & && y` a syntax
 * error), and a `#` comment swallows the rest of the line. `&&`, `||` and
 * `|` are left-associative at equal/tighter precedence and already bind the
 * appended hook correctly, so scripts carrying only those stay untouched.
 *
 * FD redirections (`2>&1`, `&>log`, `>&2`) carry a bare `&` too, but it is
 * an OPERATOR, not a statement separator: it binds tighter than `&&` in both
 * cmd.exe and POSIX sh, so flat chaining is safe there — and grouping a
 * cmd-compatible script would emit `(...)` parens cmd.exe cannot parse at
 * all (npm runs scripts through cmd.exe on Windows by default).
 */
const NEEDS_GROUPING = /(^|[^&<>])&([^&>]|$)|;|#|\n/

/**
 * Append our lifecycle hook to a host script.
 *
 * Plain one-shot commands chain flat (byte-identical to v1, and the only
 * form cmd.exe consumers ever see). Scripts with statement separators get a
 * subshell group so `&& <hook>` binds to the WHOLE script, not just its last
 * sub-command — v1's bare chaining let `;`/`&`/comments skip the hook, and a
 * trailing `# …` comment would eat a same-line `)`, so the group always
 * closes on its own line (which `unwrapGroup` reverses exactly).
 */
export function chainAfterHost(host: string): string {
  if (!NEEDS_GROUPING.test(host)) return `${host} && ${HOOK_COMMAND}`
  return `(${host}\n) && ${HOOK_COMMAND}`
}

/**
 * Drop the grouping parens chainAfterHost added — but only when they wrap
 * the ENTIRE value (a mid-script subshell is never ours). Removes exactly
 * the one newline chainAfterHost added, so the host script is restored
 * byte-for-byte.
 */
function unwrapGroup(value: string): string {
  if (!value.startsWith('(')) return value
  let depth = 0
  let quote: string | null = null
  for (let i = 0; i < value.length; i++) {
    const c = value[i]!
    if (quote) {
      if (c === '\\') i += 1
      else if (c === quote) quote = null
      continue
    }
    if (c === '"' || c === "'" || c === '`') quote = c
    else if (c === '(') depth += 1
    else if (c === ')') {
      depth -= 1
      if (depth === 0) {
        if (i !== value.length - 1) return value // wrapper isn't outermost
        const inner = value.slice(1, -1)
        return inner.endsWith('\n') ? inner.slice(0, -1) : inner
      }
    }
  }
  return value
}

function gitignoreHasEntry(contents: string, entry: string): boolean {
  return contents
    .split(/\r?\n/)
    .some((line) => line.replace(/\s+$/, '') === `/${entry.replace(/\s+$/, '')}`)
}

function appendGitignoreNote(projectRoot: string): void {
  const target = path.join(projectRoot, '.gitignore')
  let contents = ''
  try {
    contents = fs.readFileSync(target, 'utf8')
  } catch {
    contents = ''
  }

  const wanted = `/${BACKUP_DIR}`
  if (gitignoreHasEntry(contents, BACKUP_DIR)) return
  if (contents.length > 0 && !contents.endsWith('\n')) contents += '\n'
  try {
    writeAtomicSync(target, `${contents}${wanted}\n`)
  } catch {
    // A read-only .gitignore is cosmetic — the config write already succeeded
    // and must not be reported as skipped because this failed.
  }
}

/**
 * Root of the package (never written to) — the v1 self-exclusion rule.
 * The plugin's own next.config.* is never activated by its own postinstall.
 */
function resolveProjectRoot(start: string): string | null {
  let dir = path.resolve(start)
  for (;;) {
    const packageJson = path.join(dir, 'package.json')
    if (fs.existsSync(packageJson) && !isSelf(dir)) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export type RunOutcome = 'activated' | 'already-active' | 'skipped'

export interface RunOptions {
  /**
   * Ignore BLAZEFIRE_SKIP_AUTO. The postinstall honors the opt-out; the
   * explicit CLI (`npx blazefire init`) is the documented manual fallback for
   * locked-down environments that set it, so it passes true.
   */
  ignoreSkipEnv?: boolean
}

export function run(start = process.cwd(), options: RunOptions = {}): RunOutcome {
  if (process.env[SKIP_ENV] === '1' && !options.ignoreSkipEnv) {
    say(`skipped — ${SKIP_ENV}=1`)
    return 'skipped'
  }

  const { configs, packageRoots } = locateCandidates(start)
  if (configs.length === 0) {
    say('skipped — no next.config.* found in this project')
    return 'skipped'
  }

  let activated = 0
  let alreadyActive = 0
  const hookRoots = new Set<string>()
  for (let i = 0; i < configs.length; i++) {
    const configPath = configs[i]!
    const projectRoot = packageRoots[i]!
    const relative = path.relative(process.cwd(), configPath) || configPath

    if (!hasInstalledNext(projectRoot)) {
      say(`skipped ${relative} — Next.js is not installed in this project`)
      continue
    }

    // One unreadable/unwritable config must never abort the batch (or the
    // install that spawned us) — report it and keep going.
    try {
      const source = fs.readFileSync(configPath, 'utf8')
      const result = rewrite(source)
      if (!result.ok) {
        if (/already wrapped/.test(result.reason)) {
          say(`skipped ${relative} — already activated`)
          hookRoots.add(projectRoot)
          alreadyActive += 1
          continue
        }
        say(`skipped ${relative} — ${result.reason}`)
        // Provide the appropriate snippet based on the config file extension
        const isEsm = /\.(m?ts|m?js)$/.test(configPath) && !/\.cjs$/.test(configPath)
        const snippet = isEsm ? SNIPPET : CJS_REQUIRE + '\nmodule.exports = blazefire(nextConfig)'
        say(`add this next to your config manually:\n  ${snippet}`)
        continue
      }

      // Only claim the host's package.json AFTER the config write succeeds:
      // a failed backup/write leaves nothing to activate, and restore() can
      // only undo the hook when a backup exists — claiming the root early
      // would install an unremovable postinstall hook.
      hookRoots.add(projectRoot)
      const backup = path.join(
        projectRoot,
        BACKUP_DIR,
        `${path.basename(configPath)}.${new Date()
          .toISOString()
          .replace(/[:.]/g, '-')}.original`
      )
      if (!fs.existsSync(backup)) {
        fs.mkdirSync(path.dirname(backup), { recursive: true })
        fs.copyFileSync(configPath, backup)
      }

      const nextSource = result.code

      writeAtomicSync(configPath, nextSource)
      appendGitignoreNote(projectRoot)
      say(`activated ${relative}`)
      activated += 1
    } catch (error) {
      say(`skipped ${relative} — ${(error as Error)?.message ?? error}`)
      continue
    }
  }

  for (const packageRoot of hookRoots) {
    const label = path.relative(process.cwd(), packageRoot) || packageRoot
    try {
      const hook = ensureHook(packageRoot)
      if (hook.status === 'no-package-json') {
        say(`skipped host hook in ${label} — package.json missing`)
      } else if (hook.status === 'invalid-package-json') {
        say(`skipped host hook in ${label} — package.json is not valid JSON`)
      } else if (hook.status === 'host-script-invalid') {
        say(`skipped host hook in ${label} — scripts.postinstall is not a string`)
      }
    } catch (error) {
      say(`skipped host hook in ${label} — ${(error as Error)?.message ?? error}`)
    }
  }

  if (activated > 0) {
    say(`done — activated ${activated} config${activated === 1 ? '' : 's'}`)
    return 'activated'
  }
  return alreadyActive > 0 ? 'already-active' : 'skipped'
}

export function restore(start = process.cwd()): boolean {
  const { packageRoots } = locateCandidates(start)
  const resolvedRoot = resolveProjectRoot(start)
  if (resolvedRoot) {
    packageRoots.push(resolvedRoot, ...listWorkspaces(resolvedRoot))
  }
  if (packageRoots.length === 0) packageRoots.push(path.resolve(start))

  let restoredAny = false
  for (const projectRoot of new Set(packageRoots)) {
    // A single unreadable backup must not abort restoration of the others
    // (multi-project/workspace restores run in one loop).
    try {
      const backupRoot = path.join(projectRoot, BACKUP_DIR)
      let entries: string[]
      try {
        entries = fs.readdirSync(backupRoot)
      } catch {
        continue
      }

      const originals = entries
        .filter(
          (entry) =>
            entry.endsWith('.original') &&
            CONFIG_NAMES.some((name) => entry.startsWith(`${name}.`))
        )
        .sort((a, b) => a.localeCompare(b))

      const firstBackupByConfig = new Map<string, string>()
      for (const entry of originals) {
        const base = CONFIG_NAMES.find((name) => entry.startsWith(`${name}.`))
        if (base && !firstBackupByConfig.has(base)) firstBackupByConfig.set(base, entry)
      }

      let restoredProject = false
      for (const [base, entry] of firstBackupByConfig) {
        const target = path.join(projectRoot, base)
        if (!fs.existsSync(target)) {
          say(`skipped ${base} — the live config is missing; refusing to resurrect it`)
          continue
        }

        const content = fs.readFileSync(path.join(backupRoot, entry))
        writeAtomicSync(target, content)
        say(`restored ${base} from ${path.relative(process.cwd(), backupRoot) || backupRoot}`)
        restoredProject = true
      }

      if (restoredProject) {
        undoHook(projectRoot)
        restoredAny = true
      }
    } catch (error) {
      const label = path.relative(process.cwd(), projectRoot) || projectRoot
      say(`skipped restore in ${label} — ${(error as Error)?.message ?? error}`)
    }
  }

  if (!restoredAny) say('no backup found for this project')
  else say('restore complete')
  return restoredAny
}
