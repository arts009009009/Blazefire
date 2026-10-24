/**
 * Install-cache surgery — v1 port, condensed.
 *
 * Updating to an exact release is pointless if the manager serves the old
 * tarball from cache, so each manager's blazefire copies are removed before
 * the re-install. Every removal is best-effort: a failed purge only means
 * the manager may keep serving the older cached copy, which is still better
 * than aborting the update.
 */
import fs from 'node:fs'
import os from 'node:os'
import path from 'node:path'
import type { PackageManager } from './pm.js'
import { quoteForCmd } from './pm.js'
import { spawnSync } from 'node:child_process'

function removePath(target: string): boolean {
  try {
    fs.rmSync(target, { recursive: true, force: true })
    return true
  } catch {
    return false
  }
}

function globRemove(dir: string, predicate: (entry: string) => boolean): string[] {
  let entries: string[] = []
  try {
    entries = fs.readdirSync(dir)
  } catch {
    return []
  }
  const removed: string[] = []
  for (const entry of entries) {
    if (!predicate(entry)) continue
    const target = path.join(dir, entry)
    if (removePath(target)) removed.push(target)
  }
  return removed
}

/** Yarn classic: node_modules/blazefire + the yarn cache folder. */
function purgeYarnClassic(projectRoot: string, cacheDir: string): string[] {
  const removed: string[] = []
  const local = path.join(projectRoot, 'node_modules', 'blazefire')
  if (removePath(local)) removed.push(local)

  // Yarn classic caches by package name inside its cache folder.
  removed.push(...globRemove(cacheDir, (entry) => /^blazefire/i.test(entry)))
  return removed
}

/** Yarn berry: unplugged builds + the global cache zips. */
function purgeYarnBerry(projectRoot: string, cacheDir: string): string[] {
  const removed: string[] = []
  const unplugged = path.join(projectRoot, '.yarn', 'unplugged')
  removed.push(...globRemove(unplugged, (entry) => /^blazefire/i.test(entry)))

  const local = path.join(projectRoot, 'node_modules', 'blazefire')
  if (removePath(local)) removed.push(local)

  // Berry's global cache holds `blazefire-npm-<version>-<hash>.zip`.
  removed.push(...globRemove(cacheDir, (entry) => /^blazefire-npm-/i.test(entry)))
  return removed
}

function purgePnpm(projectRoot: string): string[] {
  const removed: string[] = []
  const local = path.join(projectRoot, 'node_modules', 'blazefire')
  if (removePath(local)) removed.push(local)

  // pnpm's real files live in the virtual store, hard-linked from the
  // node_modules entry — remove the store copies too or the store keeps
  // serving the old content.
  const virtualStore = path.join(projectRoot, 'node_modules', '.pnpm')
  removed.push(
    ...globRemove(virtualStore, (entry) => /^blazefire@/i.test(entry))
  )
  return removed
}

function purgeNpm(projectRoot: string): string[] {
  const removed: string[] = []
  const local = path.join(projectRoot, 'node_modules', 'blazefire')
  if (removePath(local)) removed.push(local)

  // npm's cache is content-addressed; `npm cache clean` on modern npm does
  // not reliably drop a single package, so the lockfile entries that pin the
  // old integrity are the surgical target instead.
  for (const lock of ['package-lock.json', 'npm-shrinkwrap.json']) {
    const lockPath = path.join(projectRoot, lock)
    if (removeNpmLockEntry(lockPath)) removed.push(lockPath)
  }
  return removed
}

/**
 * Drop blazefire entries from an npm lockfile. A locked
 * resolved+integrity pair is exactly what lets npm satisfy the tarball
 * from cache with no HTTP at all, so the entry has to go.
 */
export function removeNpmLockEntry(file: string): boolean {
  let parsed: {
    packages?: Record<string, unknown>
    dependencies?: Record<string, unknown>
  }
  try {
    parsed = JSON.parse(fs.readFileSync(file, 'utf8')) as never
  } catch {
    return false
  }

  let changed = false
  const strip = (map: Record<string, unknown> | undefined): void => {
    if (!map) return
    for (const key of Object.keys(map)) {
      if (key === 'blazefire' || key.endsWith('/blazefire')) {
        delete map[key]
        changed = true
      }
    }
  }
  strip(parsed.packages)
  strip(parsed.dependencies)

  if (changed) {
    try {
      // Atomic: a crash mid-write must never leave a truncated lockfile that
      // breaks `npm ci` until it is regenerated.
      const temp = `${file}.${process.pid}.tmp`
      fs.writeFileSync(temp, `${JSON.stringify(parsed, null, 2)}\n`)
      fs.renameSync(temp, file)
    } catch {
      return false
    }
  }
  return changed
}

function purgeBun(projectRoot: string): string[] {
  const removed: string[] = []
  const local = path.join(projectRoot, 'node_modules', 'blazefire')
  if (removePath(local)) removed.push(local)
  return removed
}

// --- cache-only helpers (non-destructive pre-install purge) ----------------
// These clear only the manager's EXTERNAL caches so a stale tarball is never
// served, while leaving node_modules/blazefire and lockfiles fully intact.
// That keeps a FAILED update non-destructive (the working install survives).

function purgeYarnClassicCache(cacheDir: string): string[] {
  return globRemove(cacheDir, (entry) => /^blazefire/i.test(entry))
}

function purgeYarnBerryCache(cacheDir: string): string[] {
  return globRemove(cacheDir, (entry) => /^blazefire-npm-/i.test(entry))
}

function pnpmStoreDir(projectRoot: string): string | null {
  try {
    const result = spawnSync('pnpm', ['store', 'path'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32',
    })
    const dir = (result.stdout ?? '').trim()
    if (dir) return dir
  } catch {
    // fall through
  }
  return null
}

function purgePnpmStore(projectRoot: string): string[] {
  const store = pnpmStoreDir(projectRoot)
  return store ? globRemove(store, (entry) => /blazefire/i.test(entry)) : []
}

function purgeBunCache(): string[] {
  const dir = path.join(os.homedir(), '.bun', 'install', 'cache')
  return globRemove(dir, (entry) => /blazefire/i.test(entry))
}

export interface PurgeOptions {
  /**
   * Clear only the manager's external caches (never node_modules or
   * lockfiles). Used BEFORE an install so a failed update leaves the working
   * tree untouched.
   */
  cachesOnly?: boolean
}

/**
 * Remove every cached copy of blazefire for `manager`. Returns the paths
 * removed (for logging); never throws.
 */
export function purgeCachedInstall(
  manager: PackageManager,
  projectRoot: string,
  options: PurgeOptions = {}
): string[] {
  try {
    if (options.cachesOnly) {
      switch (manager) {
        case 'yarn': {
          const cacheDir = yarnCacheDir(projectRoot)
          const isBerry = fs.existsSync(path.join(projectRoot, '.yarn'))
          return isBerry ? purgeYarnBerryCache(cacheDir) : purgeYarnClassicCache(cacheDir)
        }
        case 'pnpm':
          return purgePnpmStore(projectRoot)
        case 'bun':
          return purgeBunCache()
        default:
          // npm's cache is content-addressed; a new version always carries a
          // fresh integrity, so there is nothing stale to purge non-destructively.
          return []
      }
    }

    switch (manager) {
      case 'yarn': {
        const cacheDir = yarnCacheDir(projectRoot)
        const isBerry = fs.existsSync(path.join(projectRoot, '.yarn'))
        return isBerry
          ? purgeYarnBerry(projectRoot, cacheDir)
          : purgeYarnClassic(projectRoot, cacheDir)
      }
      case 'pnpm':
        return purgePnpm(projectRoot)
      case 'bun':
        return purgeBun(projectRoot)
      default:
        return purgeNpm(projectRoot)
    }
  } catch {
    return []
  }
}

function yarnCacheDir(projectRoot: string): string {
  try {
    const result = spawnSync('yarn', ['cache', 'dir'], {
      cwd: projectRoot,
      encoding: 'utf8',
      timeout: 5000,
      shell: process.platform === 'win32',
    })
    const dir = (result.stdout ?? '').trim()
    if (dir) return dir
  } catch {
    // fall through
  }
  return path.join(projectRoot, '.yarn', 'cache')
}

export { quoteForCmd }
