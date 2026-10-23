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
import path from 'node:path'
import { fileURLToPath } from 'node:url'
import { plan, rewrite, SNIPPET } from './scanner.js'

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

/** Root of this package (two levels up from dist/postinstall/). */
const PACKAGE_ROOT = path.join(fileURLToPath(new URL('../..', import.meta.url)))

type HookStatus =
  | { status: 'already-active' }
  | { status: 'changed' }
  | { status: 'no-package-json' }

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

  const results: string[] = []
  for (const pattern of patterns) {
    if (typeof pattern !== 'string' || pattern.includes('*')) continue
    const workspaceRoot = path.resolve(packageRoot, pattern)
    if (!fs.existsSync(path.join(workspaceRoot, 'package.json'))) continue
    if (!CONFIG_NAMES.some((name) => fs.existsSync(path.join(workspaceRoot, name)))) {
      continue
    }
    results.push(workspaceRoot)
  }
  return results
}

/**
 * Next.js must be resolvable from the project's *own* node_modules, so the
 * plugin cannot be silently activating a tree that never runs it.
 */
function hasInstalledNext(projectRoot: string): boolean {
  for (const modulePath of ['next/package.json', 'next/dist/server/next.js']) {
    const target = path.join(projectRoot, 'node_modules', ...modulePath.split('/'))
    try {
      require.resolve(modulePath, { paths: [projectRoot] })
      return true
    } catch {
      if (fs.existsSync(target)) return true
    }
  }
  return false
}

function writeAtomicSync(target: string, contents: string): void {
  const temp = path.join(
    path.dirname(target),
    `.${path.basename(target)}.${process.pid}.tmp`
  )
  fs.writeFileSync(temp, contents)
  fs.renameSync(temp, target)
}

export function locateCandidates(start: string): {
  configs: string[]
  packageRoots: string[]
} {
  const seenPackageRoots = new Set<string>()
  const packageRoots: string[] = []
  const configs: string[] = []

  const collect = (configPath: string): void => {
    const projectRoot = path.dirname(configPath)
    if (seenPackageRoots.has(projectRoot)) return
    seenPackageRoots.add(projectRoot)
    packageRoots.push(projectRoot)
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

function ensureHook(packageRoot: string): HookStatus {
  const packageJsonPath = path.join(packageRoot, 'package.json')
  if (!fs.existsSync(packageJsonPath)) return { status: 'no-package-json' }

  const contents = fs.readFileSync(packageJsonPath, 'utf8')
  let parsed: Record<string, unknown> & { scripts?: Record<string, string> }
  try {
    parsed = JSON.parse(contents) as never
  } catch {
    return { status: 'no-package-json' }
  }

  const eol = contents.includes('\r\n') ? '\r\n' : '\n'
  const scripts = { ...(parsed.scripts ?? {}) }

  const existing = scripts.postinstall
  if (existing && !isLifecycleHook(existing)) {
    // A host's own postinstall is not ours to clobber — chain ours after it.
    if (!/blazefire/.test(existing)) {
      scripts.postinstall = `${existing} && ${HOOK_COMMAND}`
    }
  } else {
    scripts.postinstall = HOOK_COMMAND
  }

  if (JSON.stringify(scripts) === JSON.stringify(parsed.scripts ?? {})) {
    return { status: 'already-active' }
  }

  const trailingNewline = contents.endsWith('\n')
  const next = `${JSON.stringify({ ...parsed, scripts }, null, 2)}${trailingNewline ? eol : ''}`
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

  const contents = fs.readFileSync(packageJsonPath, 'utf8')
  let parsed: Record<string, unknown> & { scripts?: Record<string, string> }
  try {
    parsed = JSON.parse(contents) as never
  } catch {
    return { changed: false }
  }

  const scripts = parsed.scripts
  if (!scripts) return { changed: false }

  const postinstall = scripts.postinstall
  if (!postinstall) return { changed: false }

  const previousScripts = { ...scripts }
  const eol = contents.includes('\r\n') ? '\r\n' : '\n'

  const escaped = HOOK_COMMAND.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const withoutHost = postinstall
    .replace(new RegExp(`\\s*&&\\s*${escaped}`), '')
    .trim()
  if (!withoutHost || withoutHost === HOOK_COMMAND) delete scripts.postinstall
  else scripts.postinstall = withoutHost

  const trailingNewline = contents.endsWith('\n')
  const next = `${JSON.stringify({ ...parsed, scripts }, null, 2)}${trailingNewline ? eol : ''}`
  writeAtomicSync(packageJsonPath, next)
  return { changed: true, previousScripts }
}

export function isLifecycleHook(value: string): boolean {
  return /blazefire/.test(value)
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
  writeAtomicSync(target, `${contents}${wanted}\n`)
}

/**
 * Root of the package (never written to) — the v1 self-exclusion rule.
 * The plugin's own next.config.* is never activated by its own postinstall.
 */
function resolveProjectRoot(start: string): string | null {
  let dir = path.resolve(start)
  for (;;) {
    const packageJson = path.join(dir, 'package.json')
    if (fs.existsSync(packageJson) && !isSelf(dir)) {
      for (const name of CONFIG_NAMES) {
        if (fs.existsSync(path.join(dir, name))) return dir
      }
    }
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

export function run(start = process.cwd()): void {
  if (process.env[SKIP_ENV] === '1') {
    say(`skipped — ${SKIP_ENV}=1`)
    return
  }

  const { configs, packageRoots } = locateCandidates(start)
  if (configs.length === 0) {
    say('skipped — no next.config.* found in this project')
    return
  }

  let activated = 0
  for (let i = 0; i < configs.length; i++) {
    const configPath = configs[i]!
    const projectRoot = packageRoots[i]!
    const relative = path.relative(process.cwd(), configPath) || configPath

    if (!hasInstalledNext(projectRoot)) {
      say(`skipped ${relative} — Next.js is not installed in this project`)
      continue
    }

    const source = fs.readFileSync(configPath, 'utf8')
    const result = rewrite(source)
    if (!result.ok) {
      say(`skipped ${relative} — ${result.reason}`)
      say(`add this next to your config manually:\n  ${SNIPPET}`)
      continue
    }

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
    if (!plan(nextSource).ok) {
      say(`skipped ${relative} — rewrite did not produce a recognisable config`)
      continue
    }

    writeAtomicSync(configPath, nextSource)
    appendGitignoreNote(projectRoot)
    say(`activated ${relative}`)
    activated += 1
  }

  for (const packageRoot of new Set(packageRoots)) {
    const hook = ensureHook(packageRoot)
    if (hook.status === 'no-package-json') {
      say(
        `skipped host hook in ${path.relative(process.cwd(), packageRoot) || packageRoot} — package.json missing`
      )
    }
  }

  if (activated > 0) {
    say(`done — activated ${activated} config${activated === 1 ? '' : 's'}`)
  }
}

export function restore(): boolean {
  const backupRoot = path.join(process.cwd(), BACKUP_DIR)
  let entries: string[]
  try {
    entries = fs.readdirSync(backupRoot)
  } catch {
    say(`no backup found at ${path.relative(process.cwd(), backupRoot) || backupRoot}`)
    return false
  }

  const originals = entries
    .filter((entry) => entry.endsWith('.original'))
    .sort((a, b) => a.localeCompare(b))

  if (originals.length === 0) {
    say(`no backup found at ${path.relative(process.cwd(), backupRoot) || backupRoot}`)
    return false
  }

  for (const entry of originals) {
    const base = entry.slice(0, entry.indexOf('.original'))
    const target = path.join(process.cwd(), base)
    if (!fs.existsSync(target)) {
      say(`skipped ${base} — the live config is missing; refusing to resurrect it`)
      continue
    }

    const content = fs.readFileSync(path.join(backupRoot, entry))
    fs.writeFileSync(target, content)
    say(`restored ${base} from ${path.relative(process.cwd(), backupRoot) || backupRoot}`)

    undoHook(process.cwd())
  }

  say('restore complete')
  return true
}
