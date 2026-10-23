/**
 * Package-manager detection — v1 port.
 *
 * Detection order (kept from v1): npm_config_user_agent wins when it names a
 * manager, otherwise the first lockfile found walking up from the project
 * root. Only npm / yarn / pnpm / bun are ever shelled out to, and only with
 * fixed argument shapes (no interpolated user input beyond package names and
 * registry URLs, which are shell-quoted).
 */
import fs from 'node:fs'
import path from 'node:path'

export type PackageManager = 'npm' | 'yarn' | 'pnpm' | 'bun'

const LOCKFILES: Array<{ file: string; manager: PackageManager }> = [
  { file: 'bun.lockb', manager: 'bun' },
  { file: 'bun.lock', manager: 'bun' },
  { file: 'pnpm-lock.yaml', manager: 'pnpm' },
  { file: 'yarn.lock', manager: 'yarn' },
  { file: 'package-lock.json', manager: 'npm' },
  { file: 'npm-shrinkwrap.json', manager: 'npm' },
]

export function detectPackageManager(start = process.cwd()): PackageManager {
  const ua = process.env.npm_config_user_agent ?? ''
  const fromUa = /^(npm|yarn|pnpm|bun)\//.exec(ua)
  if (fromUa) return fromUa[1] as PackageManager

  let dir = path.resolve(start)
  for (;;) {
    for (const { file, manager } of LOCKFILES) {
      if (fs.existsSync(path.join(dir, file))) return manager
    }
    const parent = path.dirname(dir)
    if (parent === dir) return 'npm'
    dir = parent
  }
}

/** Project root: nearest directory walking up with a package.json. */
export function resolveProjectRoot(start = process.cwd()): string | null {
  let dir = path.resolve(start)
  for (;;) {
    if (fs.existsSync(path.join(dir, 'package.json'))) return dir
    const parent = path.dirname(dir)
    if (parent === dir) return null
    dir = parent
  }
}

/** The blazefire spec a project currently has installed, if it names one. */
export function readInstalledSpec(projectRoot: string): string | null {
  try {
    const parsed = JSON.parse(
      fs.readFileSync(path.join(projectRoot, 'package.json'), 'utf8')
    ) as { dependencies?: Record<string, string>; devDependencies?: Record<string, string> }
    return parsed.dependencies?.blazefire ?? parsed.devDependencies?.blazefire ?? null
  } catch {
    return null
  }
}

/**
 * A spec is safe to re-install verbatim only when it is a plain version or a
 * version range. Anything else (git URLs, local paths, tags) is left alone —
 * the user manages those deliberately.
 */
export function isSafeSpec(spec: string): boolean {
  return /^[\^~><=\s\d|xX*.\-+]+$/.test(spec.trim())
}

export function quoteForCmd(manager: PackageManager, value: string): string {
  // All supported managers accept double-quoted args on POSIX and Windows
  // cmd; embedded double quotes cannot occur in the specs we accept.
  return `"${value.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`
}

/** The shell command that re-installs blazefire at `spec`. */
export function updateCommand(
  manager: PackageManager,
  spec: string
): { command: string; args: string[] } {
  const target = quoteForCmd(manager, spec)
  switch (manager) {
    case 'yarn':
      return { command: 'yarn', args: ['add', '-D', `blazefire@${spec}`] }
    case 'pnpm':
      return { command: 'pnpm', args: ['add', '-D', `blazefire@${spec}`] }
    case 'bun':
      return { command: 'bun', args: ['add', '-d', `blazefire@${spec}`] }
    default:
      // `npm i` with a quoted spec — npm also records it when --save-exact
      // or the user's .npmrc says so; we never force either.
      return { command: 'npm', args: ['install', '-D', `blazefire@${spec}`] }
  }
}

/** The full install target for a spec. */
export function specTarget(spec: string): string {
  return `blazefire@${spec}`
}
